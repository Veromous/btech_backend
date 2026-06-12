// ─── PII (Personally Identifiable Information) scanner ──────────────────────────
//
// Datasets published to DataCenter are public, so they must never carry
// information that identifies a private individual. This module inspects a
// parsed dataset (an array of row objects) and reports any columns that look
// like they hold sensitive personal data, using two independent signals:
//
//   1. Column-header heuristics — a header such as "email", "phone", "passport
//      no", "nom complet" is a strong declaration of intent.
//   2. Cell-value patterns — even with an innocent header, a column whose values
//      are mostly e-mails / phone numbers / card numbers is treated as PII.
//
// Patterns that are themselves distinctive (email, phone with country code,
// SSN, credit-card, IBAN) are flagged from values alone. Patterns that collide
// easily with ordinary numeric data (raw ID / passport numbers) are flagged
// from values only when the header also hints at an identifier, which keeps
// columns like `cases`, `tonnes`, or `year` from being rejected.

type Row = Record<string, unknown>;

export type PiiType =
    | 'Full name'
    | 'Email address'
    | 'Phone number'
    | 'National ID / CNI number'
    | 'Passport number'
    | 'Credit/debit card number'
    | 'Bank account / IBAN'
    | 'Date of birth'
    | 'Physical address'
    | 'Government ID number';

export interface PiiFinding {
    column: string;
    type: PiiType;
    /** What tipped us off: the column name, the cell values, or both. */
    via: 'header' | 'values' | 'header+values';
    /** A redacted example so the uploader can locate the offending column. */
    sample?: string;
}

export interface PiiScanResult {
    hasPii: boolean;
    findings: PiiFinding[];
}

// ─── Tunables ───────────────────────────────────────────────────────────────────
const MAX_ROWS_SCANNED = 1000;      // cap work on huge files; PII shows up early
const VALUE_MATCH_RATIO = 0.4;      // ≥40% of non-empty cells must match a pattern
const MIN_SAMPLE = 3;               // need at least this many non-empty cells to judge values

// ─── Header normalisation ───────────────────────────────────────────────────────
const normalizeHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

// Headers that legitimately contain "name" but are NOT a person's name.
const SAFE_NAME_HEADERS = new Set([
    'regionname', 'districtname', 'countryname', 'cityname', 'townname', 'villagename',
    'productname', 'categoryname', 'datasetname', 'filename', 'columnname', 'fieldname',
    'brandname', 'sciencename', 'scientificname', 'companyname', 'organizationname',
    'organisationname', 'schoolname', 'hospitalname', 'departmentname', 'cropname',
    'diseasename', 'placename', 'tablename', 'sectorname', 'projectname', 'zonename',
    'provincename', 'statename',
]);

// Header keyword → PII type. Checked as substrings of the normalised header.
const HEADER_RULES: { keywords: string[]; type: PiiType }[] = [
    {
        type: 'Full name',
        keywords: [
            'fullname', 'firstname', 'lastname', 'surname', 'givenname', 'middlename',
            'maidenname', 'fathername', 'mothername', 'spousename', 'patientname',
            'studentname', 'employeename', 'customername', 'clientname', 'personname',
            'applicantname', 'holdername', 'ownername', 'contactname', 'nomcomplet',
            'prenom', 'nomprenom',
        ],
    },
    { type: 'Email address', keywords: ['email', 'emailaddress', 'mail', 'courriel', 'eaddress'] },
    {
        type: 'Phone number',
        keywords: ['phone', 'telephone', 'mobile', 'cellphone', 'cell', 'msisdn', 'whatsapp', 'tel', 'phoneno', 'contactnumber'],
    },
    {
        type: 'National ID / CNI number',
        keywords: ['nationalid', 'cni', 'idcard', 'identitycard', 'idnumber', 'nid', 'cnino', 'carteidentite', 'numerocni'],
    },
    { type: 'Passport number', keywords: ['passport', 'passportno', 'passportnumber'] },
    { type: 'Credit/debit card number', keywords: ['creditcard', 'debitcard', 'cardnumber', 'cardno', 'ccnumber', 'pan'] },
    { type: 'Bank account / IBAN', keywords: ['iban', 'bankaccount', 'accountnumber', 'accountno', 'rib', 'swift', 'bic'] },
    { type: 'Date of birth', keywords: ['dateofbirth', 'dob', 'birthdate', 'datenaissance', 'naissance'] },
    {
        type: 'Physical address',
        keywords: ['homeaddress', 'streetaddress', 'residentialaddress', 'mailingaddress', 'postaladdress', 'adresse'],
    },
    {
        type: 'Government ID number',
        keywords: ['ssn', 'socialsecurity', 'taxid', 'tin', 'driverlicense', 'driverslicense', 'permisconduire', 'voterid'],
    },
];

// Headers that hint at *some* identifier — used to safely enable value-based
// matching for ID/passport-style numbers that would otherwise collide with data.
const ID_HINT_KEYWORDS = [
    'id', 'no', 'num', 'number', 'numero', 'code', 'ref', 'reference',
    'passport', 'cni', 'card', 'identity', 'identite', 'matricule', 'license', 'licence',
];

// ─── Value patterns ─────────────────────────────────────────────────────────────
// Distinctive: safe to flag on values alone.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
// Phone: must look like a real phone — country code, leading 00, or grouped
// separators — so bare integers (4200, 2023) are not mistaken for phone numbers.
const PHONE_RE = /^(?:\+|00)\d[\d\s().-]{6,}\d$|^\(?\d{2,4}\)?[\s.-]\d{2,4}[\s.-]\d{2,4}(?:[\s.-]\d{2,4})?$/;
// Cameroon mobile: +237 6/2 XXXXXXXX (also accepts the local 9-digit form).
const PHONE_CM_RE = /^(?:\+?237)?\s?[62]\d{7,8}$/;
const SSN_RE = /^\d{3}-\d{2}-\d{4}$/;
const IBAN_RE = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/i;
// 13–19 digit card-like sequences, optionally grouped — Luhn-checked below.
const CARD_RE = /^(?:\d[ -]?){12,18}\d$/;

// Identifier-ish: only trusted when the header also hints at an identifier.
const PASSPORT_RE = /^[A-Z]{1,2}\d{6,9}$/i;          // e.g. CM1234567
const NATIONAL_ID_RE = /^\d{8,20}$/;                  // long bare digit run

const toStr = (v: unknown): string =>
    v === null || v === undefined ? '' : String(v).trim();

/** Luhn checksum — keeps ordinary long numbers from being read as card numbers. */
function luhnValid(value: string): boolean {
    const digits = value.replace(/[^\d]/g, '');
    if (digits.length < 13 || digits.length > 19) return false;
    let sum = 0;
    let dbl = false;
    for (let i = digits.length - 1; i >= 0; i--) {
        let d = digits.charCodeAt(i) - 48;
        if (dbl) { d *= 2; if (d > 9) d -= 9; }
        sum += d;
        dbl = !dbl;
    }
    return sum % 10 === 0;
}

const headerType = (normHeader: string): PiiType | null => {
    if (normHeader === 'name' && !SAFE_NAME_HEADERS.has(normHeader)) return 'Full name';
    for (const rule of HEADER_RULES) {
        if (SAFE_NAME_HEADERS.has(normHeader)) continue;
        if (rule.keywords.some((k) => normHeader.includes(k))) return rule.type;
    }
    return null;
};

const headerHintsIdentifier = (normHeader: string): boolean =>
    ID_HINT_KEYWORDS.some((k) => normHeader.includes(k));

// Redact a sample value so we can point at the column without echoing real PII.
function redact(value: string): string {
    if (value.length <= 2) return '••';
    return value[0] + '•'.repeat(Math.min(value.length - 2, 6)) + value[value.length - 1];
}

/** Classify a single column from a sample of its cell values. */
function valueType(values: string[], headerHasIdHint: boolean): PiiType | null {
    const nonEmpty = values.filter((v) => v.length > 0);
    if (nonEmpty.length < MIN_SAMPLE) return null;

    const ratioOf = (pred: (v: string) => boolean) =>
        nonEmpty.filter(pred).length / nonEmpty.length;

    if (ratioOf((v) => EMAIL_RE.test(v)) >= VALUE_MATCH_RATIO) return 'Email address';
    if (ratioOf((v) => PHONE_CM_RE.test(v) || PHONE_RE.test(v)) >= VALUE_MATCH_RATIO) return 'Phone number';
    if (ratioOf((v) => SSN_RE.test(v)) >= VALUE_MATCH_RATIO) return 'Government ID number';
    if (ratioOf((v) => CARD_RE.test(v) && luhnValid(v)) >= VALUE_MATCH_RATIO) return 'Credit/debit card number';
    if (ratioOf((v) => IBAN_RE.test(v)) >= VALUE_MATCH_RATIO) return 'Bank account / IBAN';

    // Identifier-style numbers only count when the header agrees — avoids
    // flagging numeric measurement columns.
    if (headerHasIdHint) {
        if (ratioOf((v) => PASSPORT_RE.test(v)) >= VALUE_MATCH_RATIO) return 'Passport number';
        if (ratioOf((v) => NATIONAL_ID_RE.test(v)) >= VALUE_MATCH_RATIO) return 'National ID / CNI number';
    }
    return null;
}

/**
 * Scan a parsed dataset for personally identifiable information.
 * Returns every offending column with the type of PII detected.
 */
export function scanForPii(rows: Row[]): PiiScanResult {
    const findings: PiiFinding[] = [];
    if (!Array.isArray(rows) || rows.length === 0) return { hasPii: false, findings };

    const sample = rows.slice(0, MAX_ROWS_SCANNED);
    const columns = Array.from(new Set(sample.flatMap((r) => Object.keys(r ?? {}))));

    for (const col of columns) {
        const norm = normalizeHeader(col);
        const fromHeader = headerType(norm);
        const cellValues = sample.map((r) => toStr(r?.[col]));
        const fromValues = valueType(cellValues, headerHintsIdentifier(norm));

        const type = fromHeader ?? fromValues;
        if (!type) continue;

        const via: PiiFinding['via'] =
            fromHeader && fromValues ? 'header+values' : fromHeader ? 'header' : 'values';
        const exampleRaw = cellValues.find((v) => v.length > 0);

        findings.push({
            column: col,
            type,
            via,
            sample: exampleRaw ? redact(exampleRaw) : undefined,
        });
    }

    return { hasPii: findings.length > 0, findings };
}

/** Build a human-readable rejection message from scan findings. */
export function describePii(findings: PiiFinding[]): string {
    const parts = findings.map((f) => `"${f.column}" (${f.type})`);
    return (
        `Upload rejected: this file appears to contain personal data that cannot be published. ` +
        `Detected in ${parts.length} column${parts.length === 1 ? '' : 's'}: ${parts.join(', ')}. ` +
        `Please remove or anonymise these columns before uploading.`
    );
}
