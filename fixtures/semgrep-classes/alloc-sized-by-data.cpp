// Annotated fixture for manifests/semgrep-classes/alloc-sized-by-data.yaml (C++ rule).
#include <cstdint>
#include <vector>

struct Header {
    uint64_t numentries() const;
    int entries_size() const;
};

constexpr uint64_t kMaxEntries = 1u << 20;

void loadUnbounded(const Header& h, std::vector<double>& out) {
    uint64_t n = h.numentries();
    if (n == 0) {
        return;
    }
    // ruleid: cw-alloc-from-parsed-count-cpp
    out.resize(static_cast<size_t>(n));
}

void loadBounded(const Header& h, std::vector<double>& out) {
    uint64_t n = h.numentries();
    if (n > kMaxEntries) {
        return;
    }
    // ok: cw-alloc-from-parsed-count-cpp
    out.resize(static_cast<size_t>(n));
}

void loadRepeated(const Header& h, std::vector<double>& out) {
    int n = h.entries_size();
    // ok: cw-alloc-from-parsed-count-cpp
    out.reserve(n);
}

double* loadRaw(const Header& h) {
    auto n = h.numentries();
    // ruleid: cw-alloc-from-parsed-count-cpp
    return new double[n];
}
