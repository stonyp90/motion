# Models

Weights live here at runtime. Excluded from git — fetched by `scripts/fetch-models.sh`
(added in Phase 2 alongside the segmentation crate).

Expected layout once populated:

```
models/
  sam2-tiny.onnx        # Segment Anything 2, Tiny, ONNX export via SAMExporter
  xmem-pp.pt            # XMem++ tracking weights
  autoshot.pt           # AutoShot scene-split weights
```
