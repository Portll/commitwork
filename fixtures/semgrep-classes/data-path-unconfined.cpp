// Annotated fixture for manifests/semgrep-classes/data-path-unconfined.yaml (C++ rules).
#include <filesystem>
#include <fstream>
#include <memory>
#include <string>

namespace fs = std::filesystem;

struct Record {
    std::string getString(const std::string& key) const;
    bool hasKey(const std::string& key) const;
};

class Archive {
public:
    fs::path locate(const std::shared_ptr<Record>& entry) const;
    fs::path locateFixed() const;
    void writeEntry(const std::string& rel);
    void writeConfined(const std::string& rel);
    void dropEntry(const std::string& rel);
private:
    fs::path m_root;
};

fs::path Archive::locate(const std::shared_ptr<Record>& entry) const {
    // ruleid: cw-path-from-document-field-cpp
    auto p = m_root / entry->getString("path");
    return p;
}

fs::path Archive::locateFixed() const {
    // ok: cw-path-from-document-field-cpp
    auto p = m_root / "manifest.json";
    return p;
}

void Archive::writeEntry(const std::string& rel) {
    auto dst = m_root / rel;
    // ruleid: cw-joined-path-to-write-cpp
    create_directories(dst.parent_path());
    // ruleid: cw-joined-path-to-write-cpp
    std::ofstream stream(dst, std::ios::binary);
}

void Archive::writeConfined(const std::string& rel) {
    auto dst = m_root / rel;
    if (dst.lexically_relative(m_root).native().rfind("..", 0) == 0) {
        throw std::runtime_error("escapes root");
    }
    // ok: cw-joined-path-to-write-cpp
    create_directories(dst.parent_path());
}

void Archive::dropEntry(const std::string& rel) {
    auto victim = m_root / rel;
    // ruleid: cw-joined-path-to-write-cpp
    std::filesystem::remove_all(victim);
}
