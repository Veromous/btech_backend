import { Router, Request, Response } from 'express';
import Database from 'better-sqlite3';
import { join } from 'path';
import * as XLSX from 'xlsx';

const router = Router();
const db = new Database(join(__dirname, '../../datacenter.db'));

// ── Schema ─────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS catalog (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    category    TEXT    NOT NULL DEFAULT 'General',
    region      TEXT    NOT NULL DEFAULT 'National',
    source      TEXT    NOT NULL DEFAULT '',
    year        INTEGER,
    rowCount    INTEGER NOT NULL DEFAULT 0,
    fileSize    TEXT    NOT NULL DEFAULT '',
    data        TEXT    NOT NULL DEFAULT '[]'
  );
`);

// ── Seed helper ────────────────────────────────────────────────────────────────
const seedDatasets: {
    name: string; description: string; category: string; region: string;
    source: string; year: number; data: object[];
}[] = [
        {
            name: 'Malaria Cases by Region 2022',
            description: 'Annual confirmed malaria cases disaggregated by region and health district across Cameroon.',
            category: 'Health', region: 'Far North', source: 'Ministry of Public Health', year: 2022,
            data: [
                { region: 'Far North', district: 'Maroua Urban', cases: 4200, deaths: 18, treated: 4100 },
                { region: 'Far North', district: 'Mora', cases: 3100, deaths: 14, treated: 3050 },
                { region: 'North', district: 'Garoua', cases: 2800, deaths: 11, treated: 2750 },
                { region: 'North', district: 'Guider', cases: 1900, deaths: 8, treated: 1870 },
                { region: 'Adamawa', district: 'Ngaoundéré', cases: 1500, deaths: 6, treated: 1480 },
                { region: 'East', district: 'Bertoua', cases: 2100, deaths: 9, treated: 2060 },
            ],
        },
        {
            name: 'Cocoa Production Statistics 2019–2023',
            description: 'Annual cocoa bean production volume (tonnes) by growing region from 2019 to 2023.',
            category: 'Agriculture', region: 'Centre', source: 'National Institute of Statistics', year: 2023,
            data: [
                { year: 2019, region: 'Centre', tonnes: 85000 },
                { year: 2019, region: 'South', tonnes: 62000 },
                { year: 2019, region: 'Littoral', tonnes: 41000 },
                { year: 2020, region: 'Centre', tonnes: 88500 },
                { year: 2020, region: 'South', tonnes: 63000 },
                { year: 2020, region: 'Littoral', tonnes: 42500 },
                { year: 2021, region: 'Centre', tonnes: 91000 },
                { year: 2021, region: 'South', tonnes: 65500 },
                { year: 2021, region: 'Littoral', tonnes: 44000 },
                { year: 2022, region: 'Centre', tonnes: 93000 },
                { year: 2022, region: 'South', tonnes: 66000 },
                { year: 2022, region: 'Littoral', tonnes: 45000 },
                { year: 2023, region: 'Centre', tonnes: 95500 },
                { year: 2023, region: 'South', tonnes: 67500 },
                { year: 2023, region: 'Littoral', tonnes: 46000 },
            ],
        },
        {
            name: 'School Enrolment Rates 2023',
            description: 'Primary and secondary school net enrolment rates (%), disaggregated by gender and region.',
            category: 'Education', region: 'South West', source: 'Ministry of Basic Education', year: 2023,
            data: [
                { region: 'South West', level: 'Primary', male: 84.2, female: 82.7, total: 83.5 },
                { region: 'North West', level: 'Primary', male: 80.1, female: 79.4, total: 79.8 },
                { region: 'Littoral', level: 'Primary', male: 91.3, female: 90.5, total: 90.9 },
                { region: 'Centre', level: 'Primary', male: 88.6, female: 87.2, total: 87.9 },
                { region: 'South West', level: 'Secondary', male: 61.4, female: 58.9, total: 60.2 },
                { region: 'North West', level: 'Secondary', male: 57.8, female: 55.3, total: 56.6 },
                { region: 'Littoral', level: 'Secondary', male: 72.1, female: 70.6, total: 71.4 },
                { region: 'Centre', level: 'Secondary', male: 68.9, female: 66.4, total: 67.7 },
            ],
        },
        {
            name: 'Rainfall Patterns — North Region 2015–2023',
            description: 'Monthly average rainfall (mm) recorded across weather stations in the North Region.',
            category: 'Climate', region: 'North', source: 'Cameroon Meteorological Department', year: 2023,
            data: [
                { year: 2021, month: 'Jan', station: 'Garoua', rainfall_mm: 2 },
                { year: 2021, month: 'Feb', station: 'Garoua', rainfall_mm: 4 },
                { year: 2021, month: 'Mar', station: 'Garoua', rainfall_mm: 28 },
                { year: 2021, month: 'Apr', station: 'Garoua', rainfall_mm: 65 },
                { year: 2021, month: 'May', station: 'Garoua', rainfall_mm: 112 },
                { year: 2021, month: 'Jun', station: 'Garoua', rainfall_mm: 143 },
                { year: 2021, month: 'Jul', station: 'Garoua', rainfall_mm: 178 },
                { year: 2021, month: 'Aug', station: 'Garoua', rainfall_mm: 185 },
                { year: 2021, month: 'Sep', station: 'Garoua', rainfall_mm: 130 },
                { year: 2021, month: 'Oct', station: 'Garoua', rainfall_mm: 55 },
                { year: 2021, month: 'Nov', station: 'Garoua', rainfall_mm: 6 },
                { year: 2021, month: 'Dec', station: 'Garoua', rainfall_mm: 0 },
                { year: 2022, month: 'Jan', station: 'Garoua', rainfall_mm: 1 },
                { year: 2022, month: 'Apr', station: 'Garoua', rainfall_mm: 71 },
                { year: 2022, month: 'Jul', station: 'Garoua', rainfall_mm: 190 },
            ],
        },
        {
            name: 'Mobile Network Coverage 2023',
            description: 'Percentage of population with 2G/3G/4G coverage by region and operator.',
            category: 'Technology', region: 'Littoral', source: 'Telecoms Regulatory Board (ART)', year: 2023,
            data: [
                { region: 'Littoral', operator: 'MTN', coverage_2g: 98, coverage_3g: 94, coverage_4g: 81 },
                { region: 'Littoral', operator: 'Orange', coverage_2g: 97, coverage_3g: 92, coverage_4g: 78 },
                { region: 'Centre', operator: 'MTN', coverage_2g: 95, coverage_3g: 88, coverage_4g: 72 },
                { region: 'Centre', operator: 'Orange', coverage_2g: 94, coverage_3g: 86, coverage_4g: 69 },
                { region: 'Far North', operator: 'MTN', coverage_2g: 72, coverage_3g: 51, coverage_4g: 18 },
                { region: 'Far North', operator: 'Orange', coverage_2g: 68, coverage_3g: 47, coverage_4g: 12 },
                { region: 'North West', operator: 'MTN', coverage_2g: 76, coverage_3g: 62, coverage_4g: 34 },
                { region: 'South', operator: 'MTN', coverage_2g: 82, coverage_3g: 68, coverage_4g: 44 },
            ],
        },
        {
            name: 'Infant Mortality Rates 2018–2022',
            description: 'Under-5 and infant mortality rates (per 1000 live births) by region and year.',
            category: 'Health', region: 'Adamawa', source: 'UNICEF / Ministry of Public Health', year: 2022,
            data: [
                { year: 2018, region: 'Adamawa', under5_per_1000: 98, infant_per_1000: 62 },
                { year: 2018, region: 'Far North', under5_per_1000: 125, infant_per_1000: 78 },
                { year: 2018, region: 'Littoral', under5_per_1000: 54, infant_per_1000: 36 },
                { year: 2019, region: 'Adamawa', under5_per_1000: 94, infant_per_1000: 59 },
                { year: 2019, region: 'Far North', under5_per_1000: 118, infant_per_1000: 74 },
                { year: 2019, region: 'Littoral', under5_per_1000: 51, infant_per_1000: 34 },
                { year: 2020, region: 'Adamawa', under5_per_1000: 91, infant_per_1000: 57 },
                { year: 2020, region: 'Far North', under5_per_1000: 112, infant_per_1000: 70 },
                { year: 2020, region: 'Littoral', under5_per_1000: 48, infant_per_1000: 32 },
                { year: 2022, region: 'Adamawa', under5_per_1000: 85, infant_per_1000: 53 },
                { year: 2022, region: 'Far North', under5_per_1000: 105, infant_per_1000: 65 },
                { year: 2022, region: 'Littoral', under5_per_1000: 44, infant_per_1000: 29 },
            ],
        },
        {
            name: 'Agricultural Yield Data — West Region',
            description: 'Crop yield (kg/ha) for key food crops grown in the West Region across farming seasons.',
            category: 'Agriculture', region: 'West', source: 'MINADER', year: 2022,
            data: [
                { season: '2021A', crop: 'Maize', yield_kg_ha: 2100 },
                { season: '2021A', crop: 'Beans', yield_kg_ha: 860 },
                { season: '2021A', crop: 'Cassava', yield_kg_ha: 12500 },
                { season: '2021B', crop: 'Maize', yield_kg_ha: 1850 },
                { season: '2021B', crop: 'Beans', yield_kg_ha: 790 },
                { season: '2021B', crop: 'Cassava', yield_kg_ha: 11800 },
                { season: '2022A', crop: 'Maize', yield_kg_ha: 2250 },
                { season: '2022A', crop: 'Beans', yield_kg_ha: 910 },
                { season: '2022A', crop: 'Cassava', yield_kg_ha: 13100 },
                { season: '2022A', crop: 'Groundnut', yield_kg_ha: 960 },
                { season: '2022B', crop: 'Maize', yield_kg_ha: 2000 },
                { season: '2022B', crop: 'Beans', yield_kg_ha: 870 },
            ],
        },
        {
            name: 'Youth Unemployment Survey 2023',
            description: 'Youth (15–35) unemployment and underemployment rates by urban/rural classification and region.',
            category: 'Social', region: 'Centre', source: 'National Institute of Statistics', year: 2023,
            data: [
                { region: 'Centre', area: 'Urban', unemployment_pct: 22.4, underemployment_pct: 38.1 },
                { region: 'Centre', area: 'Rural', unemployment_pct: 14.2, underemployment_pct: 51.6 },
                { region: 'Littoral', area: 'Urban', unemployment_pct: 24.8, underemployment_pct: 36.5 },
                { region: 'Littoral', area: 'Rural', unemployment_pct: 12.9, underemployment_pct: 49.2 },
                { region: 'South West', area: 'Urban', unemployment_pct: 31.2, underemployment_pct: 42.3 },
                { region: 'South West', area: 'Rural', unemployment_pct: 18.7, underemployment_pct: 55.8 },
                { region: 'Adamawa', area: 'Urban', unemployment_pct: 26.1, underemployment_pct: 44.7 },
                { region: 'Adamawa', area: 'Rural', unemployment_pct: 16.3, underemployment_pct: 58.9 },
            ],
        },
        {
            name: 'Deforestation Index — South Region 2010–2022',
            description: 'Annual forest cover loss (hectares) and deforestation rate (%) for South Region rainforest.',
            category: 'Climate', region: 'South', source: 'Global Forest Watch / MINFOF', year: 2022,
            data: [
                { year: 2010, forest_cover_ha: 4820000, loss_ha: 28000, rate_pct: 0.58 },
                { year: 2012, forest_cover_ha: 4765000, loss_ha: 31000, rate_pct: 0.65 },
                { year: 2014, forest_cover_ha: 4702000, loss_ha: 35000, rate_pct: 0.74 },
                { year: 2016, forest_cover_ha: 4630000, loss_ha: 39000, rate_pct: 0.84 },
                { year: 2018, forest_cover_ha: 4551000, loss_ha: 42000, rate_pct: 0.92 },
                { year: 2020, forest_cover_ha: 4467000, loss_ha: 44000, rate_pct: 0.98 },
                { year: 2022, forest_cover_ha: 4380000, loss_ha: 46000, rate_pct: 1.05 },
            ],
        },
        {
            name: 'GDP Growth Indicators 2020–2023',
            description: 'Cameroon GDP, sectoral contributions (oil, non-oil, services, agriculture) and annual growth rate.',
            category: 'Finance', region: 'National', source: 'World Bank / Ministry of Finance', year: 2023,
            data: [
                { year: 2020, gdp_billion_usd: 40.0, growth_pct: -2.4, oil_pct: 6.1, agric_pct: 22.3, services_pct: 51.8 },
                { year: 2021, gdp_billion_usd: 44.9, growth_pct: 3.4, oil_pct: 5.8, agric_pct: 22.0, services_pct: 52.4 },
                { year: 2022, gdp_billion_usd: 48.7, growth_pct: 3.8, oil_pct: 5.5, agric_pct: 21.7, services_pct: 52.9 },
                { year: 2023, gdp_billion_usd: 51.2, growth_pct: 4.1, oil_pct: 5.2, agric_pct: 21.4, services_pct: 53.5 },
            ],
        },
    ];

// ── Seed on startup (only if table is empty) ──────────────────────────────────
const seedIfEmpty = () => {
    const count = (db.prepare('SELECT COUNT(*) as n FROM catalog').get() as any).n;
    if (count > 0) return;

    const insert = db.prepare(`
    INSERT INTO catalog (name, description, category, region, source, year, rowCount, fileSize, data)
    VALUES (@name, @description, @category, @region, @source, @year, @rowCount, @fileSize, @data)
  `);

    const insertMany = db.transaction((datasets: typeof seedDatasets) => {
        for (const ds of datasets) {
            const jsonData = JSON.stringify(ds.data);
            const rowCount = ds.data.length;
            // rough file size estimate
            const fileSize = jsonData.length < 1024
                ? `${jsonData.length} B`
                : `${(jsonData.length / 1024).toFixed(1)} KB`;

            insert.run({
                name: ds.name,
                description: ds.description,
                category: ds.category,
                region: ds.region,
                source: ds.source,
                year: ds.year,
                rowCount,
                fileSize,
                data: jsonData,
            });
        }
    });

    insertMany(seedDatasets);
    console.log(`✅ Catalog seeded with ${seedDatasets.length} datasets`);
};

seedIfEmpty();

// ── GET /catalog ──────────────────────────────────────────────────────────────
router.get('/', (req: Request, res: Response) => {
    try {
        const { search = '', category = '', region = '' } = req.query as Record<string, string>;

        let sql = 'SELECT id, name, description, category, region, source, year, rowCount, fileSize FROM catalog WHERE 1=1';
        const params: string[] = [];

        if (search.trim()) {
            sql += ' AND (name LIKE ? OR description LIKE ? OR category LIKE ? OR region LIKE ?)';
            const like = `%${search.trim()}%`;
            params.push(like, like, like, like);
        }
        if (category.trim()) {
            sql += ' AND category = ?';
            params.push(category.trim());
        }
        if (region.trim()) {
            sql += ' AND region = ?';
            params.push(region.trim());
        }

        sql += ' ORDER BY id ASC';
        const rows = db.prepare(sql).all(...params);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
    }
});

// ── POST /catalog ─────────────────────────────────────────────────────────────
router.post('/', (req: Request, res: Response) => {
    try {
        const { name, description, category, region, source, year, data } = req.body as {
            name: string; description?: string; category: string; region: string;
            source?: string; year?: number; data: Record<string, unknown>[];
        };

        if (!name?.trim() || !category?.trim() || !region?.trim()) {
            res.status(400).json({ error: 'name, category, and region are required' });
            return;
        }
        if (!Array.isArray(data) || data.length === 0) {
            res.status(400).json({ error: 'data must be a non-empty array' });
            return;
        }

        // ── Duplicate check ───────────────────────────────────────────────────
        const existing = db.prepare(
            'SELECT id FROM catalog WHERE LOWER(name) = LOWER(?)'
        ).get(name.trim()) as { id: number } | undefined;

        if (existing) {
            res.status(409).json({
                error: `A dataset named "${name.trim()}" already exists in the catalog (ID ${existing.id}). Please use a different name or update the existing entry.`,
            });
            return;
        }

        const jsonData = JSON.stringify(data);
        const rowCount = data.length;
        const fileSize = jsonData.length < 1024
            ? `${jsonData.length} B`
            : `${(jsonData.length / 1024).toFixed(1)} KB`;

        const result = db.prepare(`
      INSERT INTO catalog (name, description, category, region, source, year, rowCount, fileSize, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
            name.trim(),
            (description ?? '').trim(),
            category.trim(),
            region.trim(),
            (source ?? '').trim(),
            year ?? null,
            rowCount,
            fileSize,
            jsonData,
        );

        res.status(201).json({ id: result.lastInsertRowid, name, category, region, rowCount, fileSize });
    } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
    }
});

// ── GET /catalog/:id ──────────────────────────────────────────────────────────
router.get('/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const row = db.prepare('SELECT * FROM catalog WHERE id = ?').get(id) as any;
        if (!row) { res.status(404).json({ error: 'Dataset not found' }); return; }
        res.json({ ...row, data: JSON.parse(row.data) });
    } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
    }
});

// ── GET /catalog/:id/download?format=csv|json|xlsx ────────────────────────────
router.get('/:id/download', (req: Request, res: Response) => {
    const { id } = req.params;
    const format = (req.query.format as string | undefined)?.toLowerCase() ?? 'json';

    try {
        const row = db.prepare('SELECT * FROM catalog WHERE id = ?').get(id) as any;
        if (!row) { res.status(404).json({ error: 'Dataset not found' }); return; }

        const data: Record<string, unknown>[] = JSON.parse(row.data);
        const safeName = row.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();

        if (format === 'json') {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="${safeName}.json"`);
            res.json(data);
            return;
        }

        if (format === 'csv') {
            if (data.length === 0) { res.send(''); return; }
            const headers = Object.keys(data[0]);
            const rows = data.map((r) => headers.map((h) => {
                const v = r[h] ?? '';
                const s = String(v);
                return s.includes(',') || s.includes('"') || s.includes('\n')
                    ? `"${s.replace(/"/g, '""')}"` : s;
            }).join(','));
            const csv = [headers.join(','), ...rows].join('\r\n');
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${safeName}.csv"`);
            res.send(csv);
            return;
        }

        if (format === 'xlsx') {
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(data);
            XLSX.utils.book_append_sheet(wb, ws, 'Dataset');
            const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${safeName}.xlsx"`);
            res.send(buf);
            return;
        }

        res.status(400).json({ error: 'Unsupported format. Use csv, json, or xlsx.' });
    } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
    }
});

export default router;
