-- ============================================================================
-- Veridan Limited — corrected marketing copy (client site review, 2026-08-05)
--
-- WHY THIS EXISTS: 20260722000001_site_content.sql seeded `trust_signals` and
-- `about_story` with copy the founders have since rejected — specifically the
-- "dual Jamaican-Canadian citizenship" claim, which a client reviewer flagged
-- twice ("Why mention our citizenship if we are positioning as Jamaican?"),
-- plus the pre-rename founder names ("Ken Yatta and Kaylia").
--
-- The LIVE rows were already corrected directly, and lib/site-content.ts's
-- fallback constants were updated in the same change. But that seed migration
-- is `on conflict do nothing`, so a FRESH database (staging, disaster
-- recovery, a new environment) would silently re-introduce the rejected copy.
-- This migration converges both cases on the corrected text.
--
-- Deliberately an UPDATE, not a re-seed: it corrects the two rows wherever
-- they still carry the old wording, and is a no-op on a database that already
-- has the corrected values (idempotent, safe to re-run).
-- ============================================================================

update public.site_content
set value = jsonb_set(
      value,
      '{value}',
      '[{"title":"First order completed","body":"Veridan has already delivered a full commercial hardware package end-to-end — from specification review to site delivery with warranty documentation."},{"title":"Multi-origin supply chain","body":"A proven logistics footprint spanning the US, UK, and Canada — built on direct manufacturer and distributor relationships."},{"title":"Manufacturer warranties","body":"Every item ships with full manufacturer warranty documentation, so owners and contractors have recourse long after handover."}]'::jsonb
    ),
    updated_at = now()
where key = 'trust_signals'
  and value::text ilike '%citizenship%';

update public.site_content
set value = jsonb_set(
      value,
      '{value}',
      '{"heading":"Built to close Jamaica''s commercial hardware gap","body":["Architects across Jamaica routinely specify internationally certified hardware — Assa Abloy, Allegion, Schlage, Consort, LCN, Von Duprin — on commercial projects. Until Veridan, there was no dedicated local supplier built to source, land, and deliver that exact specification.","Veridan was founded by Kenyatta and Kay-Dean to close that gap: a Kingston-based specialist with a proven multi-origin supply chain spanning the United States, United Kingdom, and Canada.","The company has already executed end-to-end orders — from specification review and technical validation through managed import, site delivery, and full warranty documentation — establishing a proven, repeatable model ready for national scale."]}'::jsonb
    ),
    updated_at = now()
where key = 'about_story'
  and (value::text ilike '%citizenship%' or value::text like '%Ken Yatta%');
