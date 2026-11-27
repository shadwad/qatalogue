import struct
import unittest

import _env

_env.init()
from pipeline.scripts import build_search_index


class SearchIndexHelpers(unittest.TestCase):
    def test_strip_unescapes_html_entities_before_removing_tags(self):
        self.assertEqual(build_search_index.strip("H&lt;sub&gt;2&lt;/sub&gt;O &amp; <i>spin</i>"), "H 2 O & spin")
        self.assertEqual(build_search_index.strip("A&amp;lt;sup&amp;gt;2&amp;lt;/sup&amp;gt;   B"), "A 2 B")
        self.assertEqual(build_search_index.strip(None), "")

    def test_quantize_round_trip_and_zero_vector(self):
        dim = 4
        vec = [0.5, -1.0, 0.25, 0.0]
        blob = struct.pack(f"<{dim}f", *vec)
        qbytes, scale = build_search_index.quantize(blob, dim)
        self.assertGreater(scale, 0.0)
        unpacked = struct.unpack(f"<{dim}b", qbytes)
        for original, q in zip(vec, unpacked):
            self.assertAlmostEqual(q * scale, original, delta=scale / 2 + 1e-6)

        zeros = struct.pack(f"<{dim}f", 0.0, 0.0, 0.0, 0.0)
        zbytes, zscale = build_search_index.quantize(zeros, dim)
        self.assertEqual(zscale, 1.0)
        self.assertEqual(struct.unpack(f"<{dim}b", zbytes), (0, 0, 0, 0))


if __name__ == "__main__":
    unittest.main()
