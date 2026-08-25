from __future__ import annotations

import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort

TOLERANCE = 5e-5


def tensor_digest(tensor: onnx.TensorProto) -> str:
    clone = onnx.TensorProto()
    clone.CopyFrom(tensor)
    clone.name = ""
    return hashlib.sha256(clone.SerializeToString(deterministic=True)).hexdigest()


def type_shape(value: onnx.ValueInfoProto) -> tuple[int, tuple[int | str, ...]]:
    tensor = value.type.tensor_type
    dimensions: list[int | str] = []
    for dimension in tensor.shape.dim:
        dimensions.append(dimension.dim_value if dimension.HasField("dim_value") else "dynamic")
    return tensor.elem_type, tuple(dimensions)


def attribute_signature(attribute: onnx.AttributeProto) -> object:
    if attribute.type == onnx.AttributeProto.GRAPH:
        encoded = json.dumps(graph_signature(attribute.g), sort_keys=True, separators=(",", ":")).encode()
        return hashlib.sha256(encoded).hexdigest()
    if attribute.type == onnx.AttributeProto.GRAPHS:
        encoded = json.dumps(
            [graph_signature(graph) for graph in attribute.graphs],
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
        return hashlib.sha256(encoded).hexdigest()
    clone = onnx.AttributeProto()
    clone.CopyFrom(attribute)
    clone.name = ""
    clone.doc_string = ""
    if clone.type == onnx.AttributeProto.TENSOR:
        clone.t.name = ""
    return hashlib.sha256(clone.SerializeToString(deterministic=True)).hexdigest()


def graph_signature(graph: onnx.GraphProto) -> object:
    operators = []
    for node in graph.node:
        attributes = tuple(
            sorted((attribute.name, attribute.type, attribute_signature(attribute)) for attribute in node.attribute)
        )
        operators.append((node.op_type, node.domain, len(node.input), len(node.output), attributes))
    initializers = Counter(tensor_digest(tensor) for tensor in graph.initializer)
    return {
        "inputs": tuple(type_shape(value) for value in graph.input),
        "outputs": tuple(type_shape(value) for value in graph.output),
        "initializerPayloads": tuple(sorted(initializers.items())),
        "operators": tuple(sorted(Counter(operators).items(), key=repr)),
    }


def model_signature(path: Path) -> str:
    model = onnx.load(path)
    onnx.checker.check_model(model)
    signature = {
        "irVersion": model.ir_version,
        "opsets": sorted((item.domain, item.version) for item in model.opset_import),
        "graph": graph_signature(model.graph),
    }
    encoded = json.dumps(signature, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def inference_outputs(path: Path, audio: np.ndarray) -> np.ndarray:
    session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name
    return session.run(None, {input_name: audio.astype(np.float32)})[0]


def corpus() -> np.ndarray:
    samples = 32000
    time = np.arange(samples, dtype=np.float32) / 16000
    rng = np.random.default_rng(20260823)
    rows = [np.zeros(samples, dtype=np.float32)]
    rows.extend(0.25 * np.sin(2 * np.pi * frequency * time) for frequency in (80, 220, 440, 880, 1760, 3520))
    for position in (0, 4000, 8000, 16000, 24000, 31999):
        impulse = np.zeros(samples, dtype=np.float32)
        impulse[position] = 0.9
        rows.append(impulse)
    rows.extend(rng.normal(0, scale, samples).astype(np.float32) for scale in np.linspace(0.005, 0.25, 51))
    return np.stack(rows)


def main() -> None:
    expected = Path(sys.argv[1])
    reproduced = Path(sys.argv[2])
    expected_signature = model_signature(expected)
    reproduced_signature = model_signature(reproduced)
    if expected_signature != reproduced_signature:
        raise SystemExit(
            f"STRUCTURE: RED - expected {expected_signature}, reproduced {reproduced_signature}"
        )

    expected_output = inference_outputs(expected, corpus())
    reproduced_output = inference_outputs(reproduced, corpus())
    maximum_error = float(np.max(np.abs(expected_output - reproduced_output)))
    if maximum_error > TOLERANCE:
        raise SystemExit(f"NUMERICAL: RED - max absolute error {maximum_error} exceeds {TOLERANCE}")

    print(json.dumps({
        "schemaVersion": 1,
        "structuralDigest": expected_signature,
        "corpusRows": int(corpus().shape[0]),
        "maximumAbsoluteError": maximum_error,
        "tolerance": TOLERANCE,
        "verdict": "GREEN",
    }, indent=2))


if __name__ == "__main__":
    main()
