import unittest

import app


class KnowledgeIntegrityTests(unittest.TestCase):
    def test_all_core_concepts_have_an_explicit_coverage_level(self):
        coverage = app.KNOWLEDGE_COVERAGE["concepts"]
        self.assertEqual(13, len(coverage))
        self.assertEqual(set(range(1, 14)), {item["id"] for item in coverage})
        self.assertTrue(all(item["level"] != "missing" for item in coverage))

    def test_detailed_and_framework_evidence_are_not_mixed(self):
        totals = app.KNOWLEDGE_COVERAGE["totals"]
        self.assertEqual(27, totals["detail_blocks"])
        self.assertEqual(16, totals["framework_blocks"])
        self.assertEqual(44, totals["stage_blocks"])

        for chunk in app.KB:
            self.assertTrue(chunk.get("id"))
            self.assertTrue(chunk.get("pages"))
            self.assertIn(chunk.get("evidence_level"), {"detail", "framework", "framework_stage"})
            self.assertTrue(chunk.get("evidence_label"))
            self.assertTrue(chunk.get("evidence_note"))
            if chunk["evidence_level"] != "detail":
                self.assertNotIn("可作为本轮课标事实依据", chunk["evidence_note"])

    def test_stage_notes_are_stage_specific_and_trace_to_framework(self):
        notes = [item for item in app.KB if item.get("scope") == "framework_stage"]
        self.assertEqual(44, len(notes))
        self.assertTrue(all(len(item.get("stages", [])) == 1 for item in notes))
        self.assertTrue(all(item.get("evidence_parent_id", "").endswith("-framework") for item in notes))

    def test_retrieval_returns_selected_stage_note_for_unfinished_concept(self):
        results = app.retrieve(
            "摩擦力对运动的影响",
            stage="5-6",
            concept="物质的运动与相互作用",
            limit=3,
        )
        self.assertTrue(results)
        self.assertEqual("5-6", results[0]["stages"][0])
        self.assertEqual("framework_stage", results[0]["evidence_level"])

    def test_public_source_exposes_evidence_provenance(self):
        document = app._chunk_to_document(app.KB[0])
        source = app._public_source(document)
        for key in ("evidence_level", "evidence_label", "evidence_note", "source_file", "source_pages"):
            self.assertIn(key, source)
            self.assertTrue(source[key])


if __name__ == "__main__":
    unittest.main()
