# PLANTED for bin/model-artefacts.mjs. Never imported, never executed; the hub is never contacted.
from transformers import AutoModel
from datasets import load_dataset


def load():
    model = AutoModel.from_pretrained("canary-org/canary-model", trust_remote_code=True)
    data = load_dataset("canary-org/canary-dataset", revision="main")
    return model, data
