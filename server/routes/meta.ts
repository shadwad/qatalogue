import express from 'express';
import { databaseGeneratedAt, getDb, hasTable, onDatabaseChange } from '../services/db';
import { excludePlaceholders } from '../services/placeholders';
import { sendError, UnavailableError } from '../services/utils';

/**
 * GET /api/meta — facts about the loaded dataset that the UI should not hard-code.
 *   { year_min, year_max, generated_at }  publication-year range and build timestamp
 *   totals: { institution, researcher, paper }  how many the whole dataset has (what the unfiltered lists show)
 * Computed once per database: the serve DB is replaced wholesale by the pipeline, and the server notices and starts over.
 */
const router = express.Router();
const db = getDb();

type Meta = {
  year_min: number;
  year_max: number;
  totals: { institution: number; researcher: number; paper: number };
  generated_at: string;
};
let cached: Meta | null = null;
onDatabaseChange(() => { cached = null; });

router.get('/', (_req, res) => {
  try {
    if (!cached) {
      const row = db.prepare('SELECT MIN(year) AS year_min, MAX(year) AS year_max FROM paper_facts WHERE year IS NOT NULL')
        .get() as { year_min: number | null; year_max: number | null };
      if (row.year_min === null || row.year_max === null) throw new UnavailableError('No publication years in dataset (run: make all).');
      const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
      const summary = hasTable('performance_summary');
      const totals = {
        institution: summary
          ? count("SELECT COUNT(DISTINCT s.entity_id) AS n FROM performance_summary s JOIN institutions i ON i.inst_id = s.entity_id WHERE s.entity_type = 'institution' AND i.display_name IS NOT NULL AND TRIM(i.display_name) <> ''")
          : count("SELECT COUNT(DISTINCT a2i.institution_id) AS n FROM author_institution_paper_facts a2i JOIN institutions i ON i.inst_id = a2i.institution_id WHERE i.display_name IS NOT NULL AND TRIM(i.display_name) <> ''"),
        researcher: summary
          ? count("SELECT COUNT(DISTINCT s.entity_id) AS n FROM performance_summary s JOIN authors a ON a.author_id = s.entity_id WHERE s.entity_type = 'researcher' AND a.name IS NOT NULL AND TRIM(a.name) <> ''")
          : count(`SELECT COUNT(DISTINCT apf.author_id) AS n FROM author_paper_facts apf JOIN authors a ON a.author_id = apf.author_id WHERE a.name IS NOT NULL AND TRIM(a.name) <> ''${excludePlaceholders('apf.author_id')}`),
        paper: count('SELECT COUNT(*) AS n FROM paper_facts'),
      };
      cached = {
        year_min: row.year_min,
        year_max: row.year_max,
        totals,
        generated_at: databaseGeneratedAt().toISOString(),
      };
    }
    res.set('Cache-Control', 'no-cache').json(cached);
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
