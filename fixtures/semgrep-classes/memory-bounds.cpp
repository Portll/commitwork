// Annotated fixture for manifests/semgrep-classes/memory-bounds.yaml.
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <vector>

struct Node { int id; };
struct Graph { void insert(Node* n); };

void buildGrowing(Graph& g, int count) {
    std::vector<Node> nodes;
    nodes.resize(count);
    for (int i = 0; i < count; i++) {
        nodes.push_back(Node{i});
        // ruleid: cw-pointer-into-growing-vector-cpp
        Node *ptr = &(nodes[nodes.size() - 1]);
        g.insert(ptr);
    }
}

void buildReserved(Graph& g, int count) {
    std::vector<Node> nodes;
    nodes.reserve(count);
    for (int i = 0; i < count; i++) {
        nodes.push_back(Node{i});
        // ok: cw-pointer-into-growing-vector-cpp
        Node *ptr = &nodes.back();
        g.insert(ptr);
    }
}

const uint8_t* sliceWrapping(const uint8_t* data, size_t length, uint64_t offset, uint64_t size) {
    // ruleid: cw-bounds-check-sum-overflow
    if (offset + size > length) {
        throw std::range_error("out of bounds");
    }
    return data + offset;
}

const uint8_t* sliceSafe(const uint8_t* data, size_t length, uint64_t offset, uint64_t size) {
    // ok: cw-bounds-check-sum-overflow
    if (offset > length || size > length - offset) {
        throw std::range_error("out of bounds");
    }
    return data + offset;
}
