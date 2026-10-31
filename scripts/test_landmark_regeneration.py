"""Regenerate from cached source data: plaque details and corrections must survive."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent


class LandmarkRegenerationTests(unittest.TestCase):
    def test_both_importers_preserve_plaque_tags_and_reapply_verified_corrections(self):
        for executable, script in [('python3', 'regenerate_local_landmarks.py'), ('node', 'regenerate-local-landmarks.js')]:
            with self.subTest(importer=script), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                data = root / 'data'
                data.mkdir()
                (data / 'local-landmarks.overpassql').write_text('unused cached query')
                (data / 'epping-forest-land.geojson').write_text(json.dumps({'features': [{
                    'geometry': {'type': 'Polygon', 'coordinates': [[[0.05, 51.65], [0.051, 51.65], [0.051, 51.651], [0.05, 51.65]]]}
                }]}))
                (data / 'landmark-corrections.json').write_text(json.dumps({'corrections': {
                    'node/1': {'properties': {'memorial': 'blue_plaque'}, 'source': 'https://example.org/survey', 'verifiedOn': '2026-10-31'}
                }}))
                tags = [
                    {'historic': 'memorial'},
                    {'historic': 'memorial', 'memorial': 'plaque', 'colour': 'blue'},
                    {'historic': 'memorial', 'memorial:type': 'plaque', 'colour': 'bronze'},
                    {'historic': 'memorial', 'memorial': 'statue', 'colour': 'blue'},
                ]
                (data / 'local-landmarks.overpass.json').write_text(json.dumps({'elements': [
                    {'type': 'node', 'id': i + 1, 'lon': 0.05, 'lat': 51.65, 'tags': tag} for i, tag in enumerate(tags)
                ]}))
                for _ in range(2):
                    run = subprocess.run([executable, str(ROOT / 'scripts' / script), '--use-cache'], cwd=root, capture_output=True, text=True, timeout=15)
                    self.assertEqual(run.returncode, 0, run.stderr)
                    places = {f['id']: f['properties'] for f in json.loads((data / 'local-landmarks.geojson').read_text())['features']}
                    self.assertEqual(places['node/1']['categoryLabel'], 'Blue plaque')
                    self.assertEqual(places['node/2']['category'], 'plaque')
                    self.assertEqual(places['node/2']['colour'], 'blue')
                    self.assertEqual(places['node/3']['categoryLabel'], 'Plaque')
                    self.assertEqual(places['node/3']['memorial:type'], 'plaque')
                    self.assertEqual(places['node/4']['category'], 'memorial')
                    self.assertEqual(places['node/1']['historic'], 'memorial')
                    (data / 'local-landmarks.geojson').write_text('{}')
