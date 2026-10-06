#!/usr/bin/env python3
"""Extract a curated, web-friendly GLB from the supplied Blender 2.76 road pack.

The production environment intentionally does not depend on Blender.  This tiny
reader uses the file's own SDNA metadata and only exports the named mesh modules
needed by Capy Cab.  The original upload remains untouched.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import struct
from io import BytesIO
from pathlib import Path

from PIL import Image


MODULES = {
    "OBRoad Straight 2 Model": "RoadStraight",
    "OBRoad Curve Model": "RoadCurve",
    "OBRoad S-Curve Model": "RoadSCurve",
    "OBRoad Cross Road Model": "RoadCross",
    "OBRoad Join Road Model": "RoadJoin",
    "OBRoad Lift Highway Model": "RoadLiftHighway",
    "OBSingleLane Straight 1 Model": "SingleLaneStraight",
    "OBSingleLane Curve Model": "SingleLaneCurve",
    "OBSingleLane End Model": "SingleLaneEnd",
    "OBHighway Straight 2 Model": "HighwayStraight",
    "OBHighway Curve 1 Model": "HighwayCurve",
    "OBHighway S-Curve Model": "HighwaySCurve",
    "OBHighway Cross Road Model": "HighwayCrossRoad",
    "OBHighway Join Highway 1 Model": "HighwayMerge",
    "OBFreeway Straight 2 Model": "FreewayStraight",
    "OBFreeway Curve 1 Model": "FreewayCurve",
    "OBFreeway S-Curve Model": "FreewaySCurve",
    "OBFreeway Cross Road Model": "FreewayCrossRoad",
    "OBFreeway Cross Freeway Model": "FreewayCrossFreeway",
    "OBFreeway Lift Highway Model": "FreewayRamp",
    "OBFreeway Join Freeway 2 Model": "FreewayMerge",
    "OBHighway Cross Freeway Model": "StackInterchange",
    "OBHighway Bridge 1 Model.001": "SuspensionBridge",
    "OBHighway Bridge 2 Model": "HighwayBridge",
    "OBParkinglot Center 1 Model": "ParkingLotCenter",
    "OBParkinglot Corner 1 Model": "ParkingLotCorner",
    "OBParkinglot Edge 1 Model": "ParkingLotEdge",
    "OBParkinglot Entrance Model": "ParkingLotEntrance",
    "OBTunnel Curve Model": "TunnelCurve",
    "OBTunnel Straight 1 Model": "TunnelStraight",
    "OBTunnel Entrance 2 Model": "TunnelPortal",
}


def padded(data: bytes, fill: bytes = b"\0") -> bytes:
    return data + fill * ((4 - len(data) % 4) % 4)


def embedded_pngs(source: bytes) -> list[bytes]:
    images: list[bytes] = []
    cursor = 0
    signature = b"\x89PNG\r\n\x1a\n"
    while True:
        start = source.find(signature, cursor)
        if start < 0:
            break
        end = start + len(signature)
        while end + 12 <= len(source):
            length = int.from_bytes(source[end:end + 4], "big")
            chunk = source[end + 4:end + 8]
            end += 12 + length
            if chunk == b"IEND":
                break
        images.append(source[start:end])
        cursor = end
    return images


def read_blocks(source: bytes):
    if source[:7] != b"BLENDER" or source[7:8] != b"-" or source[8:9] != b"v":
        raise ValueError("Expected a 64-bit little-endian Blender file")
    block_format = "<4siQii"
    header_size = struct.calcsize(block_format)
    cursor = 12
    blocks = []
    while cursor + header_size <= len(source):
        code, length, address, sdna, count = struct.unpack_from(block_format, source, cursor)
        cursor += header_size
        block = {
            "code": code.decode("latin1").rstrip("\0"),
            "length": length,
            "address": address,
            "sdna": sdna,
            "count": count,
            "offset": cursor,
        }
        blocks.append(block)
        cursor += length
        if code == b"ENDB":
            break
    return blocks


def id_name(source: bytes, block) -> str:
    raw = source[block["offset"] + 32:block["offset"] + 98]
    return raw.split(b"\0", 1)[0].decode("utf-8", "replace")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()

    source = args.source.read_bytes()
    blocks = read_blocks(source)
    by_address = {block["address"]: block for block in blocks if block["address"]}
    names = {
        block["address"]: id_name(source, block)
        for block in blocks
        if block["code"] in {"OB", "ME", "MA", "IM"}
    }
    objects = {names[block["address"]]: block for block in blocks if block["code"] == "OB"}

    palettes = embedded_pngs(source)
    road_palette = next((png for png in palettes if Image.open(BytesIO(png)).size == (16, 16)), None)
    if road_palette is None:
        raise ValueError("The supplied road colour palette is missing")

    binary = bytearray()
    views: list[dict] = []
    accessors: list[dict] = []
    meshes: list[dict] = []
    nodes: list[dict] = []
    manifest = []

    def append_view(payload: bytes, target: int | None = None) -> int:
        while len(binary) % 4:
            binary.append(0)
        offset = len(binary)
        binary.extend(payload)
        view = {"buffer": 0, "byteOffset": offset, "byteLength": len(payload)}
        if target is not None:
            view["target"] = target
        views.append(view)
        return len(views) - 1

    def append_accessor(payload: bytes, component_type: int, count: int, kind: str, minimum=None, maximum=None, target=34962) -> int:
        accessor = {
            "bufferView": append_view(payload, target),
            "componentType": component_type,
            "count": count,
            "type": kind,
        }
        if minimum is not None:
            accessor["min"] = minimum
        if maximum is not None:
            accessor["max"] = maximum
        accessors.append(accessor)
        return len(accessors) - 1

    for object_name, output_name in MODULES.items():
        object_block = objects.get(object_name)
        if object_block is None:
            raise ValueError(f"Missing supplied module: {object_name}")
        object_offset = object_block["offset"]
        mesh_address = struct.unpack_from("<Q", source, object_offset + 296)[0]
        mesh_block = by_address[mesh_address]
        mesh_offset = mesh_block["offset"]
        vertex_address = struct.unpack_from("<Q", source, mesh_offset + 232)[0]
        polygon_address = struct.unpack_from("<Q", source, mesh_offset + 168)[0]
        loop_address = struct.unpack_from("<Q", source, mesh_offset + 184)[0]
        uv_address = struct.unpack_from("<Q", source, mesh_offset + 192)[0]
        vertex_count = struct.unpack_from("<i", source, mesh_offset + 1320)[0]
        polygon_count = struct.unpack_from("<i", source, mesh_offset + 1336)[0]

        vertex_offset = by_address[vertex_address]["offset"]
        polygon_offset = by_address[polygon_address]["offset"]
        loop_offset = by_address[loop_address]["offset"]
        uv_offset = by_address[uv_address]["offset"] if uv_address else None

        vertices = []
        normals = []
        for index in range(vertex_count):
            offset = vertex_offset + index * 20
            x, y, z = struct.unpack_from("<3f", source, offset)
            nx, ny, nz = struct.unpack_from("<3h", source, offset + 12)
            vertices.append((x, z, -y))
            length = max(1.0, math.sqrt(nx * nx + ny * ny + nz * nz))
            normals.append((nx / length, nz / length, -ny / length))

        positions: list[float] = []
        output_normals: list[float] = []
        uvs: list[float] = []
        indices: list[int] = []
        minimum = [math.inf, math.inf, math.inf]
        maximum = [-math.inf, -math.inf, -math.inf]

        def emit(loop_index: int):
            vertex_index = struct.unpack_from("<i", source, loop_offset + loop_index * 8)[0]
            position = vertices[vertex_index]
            normal = normals[vertex_index]
            if uv_offset is not None:
                u, v = struct.unpack_from("<2f", source, uv_offset + loop_index * 12)
            else:
                u, v = 0.5, 0.5
            output_index = len(positions) // 3
            positions.extend(position)
            output_normals.extend(normal)
            uvs.extend((u, 1.0 - v))
            indices.append(output_index)
            for axis in range(3):
                minimum[axis] = min(minimum[axis], position[axis])
                maximum[axis] = max(maximum[axis], position[axis])

        for polygon_index in range(polygon_count):
            offset = polygon_offset + polygon_index * 12
            loop_start, loop_count = struct.unpack_from("<2i", source, offset)
            if loop_count < 3:
                continue
            for corner in range(1, loop_count - 1):
                emit(loop_start)
                emit(loop_start + corner)
                emit(loop_start + corner + 1)

        position_bytes = struct.pack("<" + "f" * len(positions), *positions)
        normal_bytes = struct.pack("<" + "f" * len(output_normals), *output_normals)
        uv_bytes = struct.pack("<" + "f" * len(uvs), *uvs)
        index_component = 5123 if len(positions) // 3 <= 65535 else 5125
        index_code = "H" if index_component == 5123 else "I"
        index_bytes = struct.pack("<" + index_code * len(indices), *indices)
        primitive = {
            "attributes": {
                "POSITION": append_accessor(position_bytes, 5126, len(positions) // 3, "VEC3", minimum, maximum),
                "NORMAL": append_accessor(normal_bytes, 5126, len(output_normals) // 3, "VEC3"),
                "TEXCOORD_0": append_accessor(uv_bytes, 5126, len(uvs) // 2, "VEC2"),
            },
            "indices": append_accessor(index_bytes, index_component, len(indices), "SCALAR", target=34963),
            "material": 0,
        }
        meshes.append({"name": output_name, "primitives": [primitive], "extras": {"sourceObject": object_name}})
        nodes.append({"name": f"SuppliedRoadPack_{output_name}", "mesh": len(meshes) - 1})
        manifest.append({
            "name": output_name,
            "sourceObject": object_name,
            "vertices": len(positions) // 3,
            "triangles": len(indices) // 3,
            "bounds": {"min": minimum, "max": maximum},
        })

    image_view = append_view(road_palette)
    gltf = {
        "asset": {
            "version": "2.0",
            "generator": "Capy Cab SDNA road-pack extractor",
            "copyright": "User-supplied Low Poly Road Pack, adapted for this project",
        },
        "scene": 0,
        "scenes": [{"name": "Curated supplied road modules", "nodes": list(range(len(nodes)))}],
        "nodes": nodes,
        "meshes": meshes,
        "materials": [{
            "name": "Supplied Road Palette",
            "pbrMetallicRoughness": {
                "baseColorTexture": {"index": 0},
                "metallicFactor": 0.0,
                "roughnessFactor": 0.86,
            },
            "doubleSided": True,
        }],
        "textures": [{"sampler": 0, "source": 0}],
        "samplers": [{"magFilter": 9728, "minFilter": 9728, "wrapS": 33071, "wrapT": 33071}],
        "images": [{"name": "Colorscheme Road", "mimeType": "image/png", "bufferView": image_view}],
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": views,
        "accessors": accessors,
        "extras": {
            "source": args.source.name,
            "modules": manifest,
            "usage": "Curated bridge, expressway, ramp, interchange and tunnel modules",
        },
    }
    json_chunk = padded(json.dumps(gltf, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), b" ")
    binary_chunk = padded(bytes(binary))
    output = bytearray(struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(json_chunk) + 8 + len(binary_chunk)))
    output.extend(struct.pack("<I4s", len(json_chunk), b"JSON"))
    output.extend(json_chunk)
    output.extend(struct.pack("<I4s", len(binary_chunk), b"BIN\0"))
    output.extend(binary_chunk)
    args.destination.parent.mkdir(parents=True, exist_ok=True)
    args.destination.write_bytes(output)
    print(json.dumps({"destination": str(args.destination), "bytes": len(output), "modules": manifest}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
