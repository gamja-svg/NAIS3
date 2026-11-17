# 콕 찍기 모델 (MobileSAM, ONNX)

검수 모드의 검열 > 콕 찍기가 처음 쓸 때 받아 가는 모양 따기 모델입니다. 앱은 이 폴더의 파일을
커밋 주소로 받아서 SHA-256을 확인합니다. 파일을 바꾸면 앱 쪽 주소와 해시도 함께 바꿔야 합니다
(`src/main/custom/censor-sam.ts`).

| 파일 | 크기 | SHA-256 |
| --- | --- | --- |
| `mobile_sam_encoder.onnx` | 27,969,715 | `a6a1e4de3f37c02010545c2edbeeeac8cc90ad1020a681b214c22f8b5f313888` |
| `mobile_sam_decoder.onnx` | 16,496,916 | `8f72ca4fb1b501bd030c19090f39d547987b609f79c1e9fc66f13b06a71d431f` |

- 출처: [MobileSAM](https://github.com/ChaoningZhang/MobileSAM) (Apache-2.0)의 공개 가중치 `mobile_sam.pt`
- 만든 방법: `export.py` (opset 17). 인코더는 1x3x1024x1024 입력, 디코더는 후보 4장을 모두 돌려줍니다.

```sh
git clone https://github.com/ChaoningZhang/MobileSAM src
pip install torch torchvision timm onnx onnxscript
python export.py src mobile_sam.pt .
```
