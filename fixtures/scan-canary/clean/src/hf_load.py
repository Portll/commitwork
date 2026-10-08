# The same hub-loading surface as dirty/src/hf_load.py, done properly: both calls pin a commit sha
# and nothing asks for remote code. Never imported, never executed.
from transformers import AutoModel
from datasets import load_dataset


def load():
    model = AutoModel.from_pretrained("canary-org/canary-model", revision="0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c")
    data = load_dataset("canary-org/canary-dataset", revision="abcdef0123456789abcdef0123456789abcdef01")
    return model, data
