import sys, warnings, torch, numpy as np
sys.path.insert(0, sys.argv[1])
from mobile_sam import sam_model_registry
from mobile_sam.utils.onnx import SamOnnxModel
warnings.filterwarnings("ignore")
ckpt, out = sys.argv[2], sys.argv[3]
sam = sam_model_registry["vit_t"](checkpoint=ckpt).eval()
x = torch.randn(1, 3, 1024, 1024)
torch.onnx.export(sam.image_encoder, x, f"{out}/mobile_sam_encoder.onnx", input_names=["image"],
                  output_names=["embedding"], opset_version=17, do_constant_folding=True, dynamo=False)
dec = SamOnnxModel(sam, return_single_mask=False)
dummy = {
    "image_embeddings": torch.randn(1, 256, 64, 64),
    "point_coords": torch.randint(0, 1024, (1, 2, 2), dtype=torch.float),
    "point_labels": torch.randint(0, 4, (1, 2), dtype=torch.float),
    "mask_input": torch.randn(1, 1, 256, 256),
    "has_mask_input": torch.tensor([1], dtype=torch.float),
    "orig_im_size": torch.tensor([512, 384], dtype=torch.float),
}
torch.onnx.export(dec, tuple(dummy.values()), f"{out}/mobile_sam_decoder.onnx", input_names=list(dummy),
                  output_names=["masks", "iou_predictions", "low_res_masks"], opset_version=17,
                  do_constant_folding=True, dynamo=False,
                  dynamic_axes={"point_coords": {1: "n"}, "point_labels": {1: "n"}})
print("exported")
