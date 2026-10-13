import sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import cv2
import numpy as np
from omr_engine import recognize

class GeometryTest(unittest.TestCase):
    def test_clean_five_lines(self):
        img=np.full((280,700),255,np.uint8)
        for y in (110,122,134,146,158): cv2.line(img,(20,y),(680,y),0,1)
        path=Path('/tmp/score-condensor-omr-test.png')
        cv2.imwrite(str(path),img)
        try:
            data=recognize(path)
            self.assertEqual(data['staffCount'],1)
            self.assertAlmostEqual(data['staves'][0]['spacing'],12,delta=1)
            self.assertFalse(data['accuracyCertified'])
        finally:path.unlink(missing_ok=True)
    def test_corrupt_input(self):
        path=Path('/tmp/score-condensor-omr-bad.png');path.write_bytes(b'nope')
        try:
            with self.assertRaises(ValueError):recognize(path)
        finally:path.unlink(missing_ok=True)
if __name__=='__main__':unittest.main()
