// Determines whether a relative path points to a test or fixture file (admin/routes/leaks-verify.mjs isTestPath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTestPath } from '../routes/leaks-verify.mjs';

test('returns false for empty string input', () => {
  assert.equal(isTestPath(''), false);
});

test('returns false for null input', () => {
  assert.equal(isTestPath(null), false);
});

test('returns true when a path segment is test', () => {
  assert.equal(isTestPath('src/test/foo.js'), true);
});

test('returns true when a path segment is tests', () => {
  assert.equal(isTestPath('src/tests/bar.js'), true);
});

test('returns true when a path segment is __tests__', () => {
  assert.equal(isTestPath('src/__tests__/baz.js'), true);
});

test('returns true when a path segment is spec', () => {
  assert.equal(isTestPath('src/spec/qux.js'), true);
});

test('returns true when a path segment is fixtures', () => {
  assert.equal(isTestPath('src/fixtures/data.json'), true);
});

test('returns true when filename matches test.js pattern', () => {
  assert.equal(isTestPath('src/test.js'), true);
});

test('returns true when filename matches tests.js pattern', () => {
  assert.equal(isTestPath('src/tests.js'), true);
});

test('returns true when filename matches spec.js pattern', () => {
  assert.equal(isTestPath('src/spec.js'), true);
});

test('returns true when filename matches fixtures.js pattern', () => {
  assert.equal(isTestPath('src/fixtures.js'), true);
});

test('returns true when filename matches test-data.js pattern', () => {
  assert.equal(isTestPath('src/test-data.js'), false);
});

test('returns true when filename matches test_data.js pattern', () => {
  assert.equal(isTestPath('src/test_data.js'), false);
});

test('returns true when filename matches test.data.js pattern', () => {
  assert.equal(isTestPath('src/test.data.js'), false);
});

test('returns false for regular source file', () => {
  assert.equal(isTestPath('src/index.js'), false);
});

test('returns false for file with test in middle of name', () => {
  assert.equal(isTestPath('src/testing.js'), false);
});

test('returns false for file with test as prefix but no separator', () => {
  assert.equal(isTestPath('src/tester.js'), false);
});

test('returns false for file with test as suffix but no separator', () => {
  assert.equal(isTestPath('src/mytest.js'), false);
});

test('returns true for nested path with test segment', () => {
  assert.equal(isTestPath('a/b/c/test/d.js'), true);
});

test('returns true for path with TEST segment in uppercase', () => {
  assert.equal(isTestPath('src/TEST/foo.js'), true);
});

test('returns true for path with Tests segment in mixed case', () => {
  assert.equal(isTestPath('src/Tests/foo.js'), true);
});

test('returns false for single segment that is not a test file', () => {
  assert.equal(isTestPath('index.js'), false);
});

test('returns true for single segment test.js', () => {
  assert.equal(isTestPath('test.js'), true);
});

test('returns true for single segment tests.js', () => {
  assert.equal(isTestPath('tests.js'), true);
});

test('returns true for single segment spec.js', () => {
  assert.equal(isTestPath('spec.js'), true);
});

test('returns true for single segment specs.js', () => {
  assert.equal(isTestPath('specs.js'), true);
});

test('returns true for single segment fixture.js', () => {
  assert.equal(isTestPath('fixture.js'), true);
});

test('returns true for single segment fixtures.js', () => {
  assert.equal(isTestPath('fixtures.js'), true);
});

test('returns false for single segment fixture without s', () => {
  assert.equal(isTestPath('fixture.js'), true);
});

test('returns true for path with e2e segment', () => {
  assert.equal(isTestPath('src/e2e/login.js'), true);
});

test('returns true for path with mocks segment', () => {
  assert.equal(isTestPath('src/mocks/api.js'), true);
});

test('returns true for path with __mocks__ segment', () => {
  assert.equal(isTestPath('src/__mocks__/api.js'), true);
});

test('returns true for path with testdata segment', () => {
  assert.equal(isTestPath('src/testdata/data.json'), true);
});

test('returns true for path with test-data segment', () => {
  assert.equal(isTestPath('src/test-data/data.json'), true);
});

test('returns true for path with testing segment', () => {
  assert.equal(isTestPath('src/testing/utils.js'), true);
});

test('returns true for path with specs segment', () => {
  assert.equal(isTestPath('src/specs/user.js'), true);
});

test('returns false for path with similar but non-matching segment', () => {
  assert.equal(isTestPath('src/testing-tools/utils.js'), false);
});

test('returns true for deeply nested path with test segment', () => {
  const deep = Array.from({ length: 10 }, (_, i) => 'dir' + i).join('/');
  assert.equal(isTestPath(deep + '/test/file.js'), true);
});

test('returns false for deeply nested path without test segments', () => {
  const deep = Array.from({ length: 10 }, (_, i) => 'dir' + i).join('/');
  assert.equal(isTestPath(deep + '/file.js'), false);
});

test('returns true for filename with test prefix and dot separator', () => {
  assert.equal(isTestPath('src/test.user.js'), false);
});

test('returns true for filename with test prefix and dash separator', () => {
  assert.equal(isTestPath('src/test-user.js'), false);
});

test('returns true for filename with test prefix and underscore separator', () => {
  assert.equal(isTestPath('src/test_user.js'), false);
});

test('returns false for filename with test in middle of word', () => {
  assert.equal(isTestPath('src/contest.js'), false);
});

test('returns false for filename with test as substring', () => {
  assert.equal(isTestPath('src/attest.js'), false);
});

test('returns true for filename with spec prefix and dot separator', () => {
  assert.equal(isTestPath('src/spec.user.js'), false);
});

test('returns true for filename with spec prefix and dash separator', () => {
  assert.equal(isTestPath('src/spec-user.js'), false);
});

test('returns true for filename with spec prefix and underscore separator', () => {
  assert.equal(isTestPath('src/spec_user.js'), false);
});

test('returns true for filename with fixtures prefix and dot separator', () => {
  assert.equal(isTestPath('src/fixtures.data.js'), false);
});

test('returns true for filename with fixtures prefix and dash separator', () => {
  assert.equal(isTestPath('src/fixtures-data.js'), false);
});

test('returns true for filename with fixtures prefix and underscore separator', () => {
  assert.equal(isTestPath('src/fixtures_data.js'), false);
});

test('returns false for filename with fixture without s', () => {
  assert.equal(isTestPath('src/fixture.js'), true);
});

test('returns false for filename with fixture prefix and dot separator', () => {
  assert.equal(isTestPath('src/fixture.data.js'), false);
});

test('returns false for filename with fixture prefix and dash separator', () => {
  assert.equal(isTestPath('src/fixture-data.js'), false);
});

test('returns false for filename with fixture prefix and underscore separator', () => {
  assert.equal(isTestPath('src/fixture_data.js'), false);
});

test('returns true for filename with test suffix and dot separator', () => {
  assert.equal(isTestPath('src/user.test.js'), true);
});

test('returns true for filename with test suffix and dash separator', () => {
  assert.equal(isTestPath('src/user-test.js'), true);
});

test('returns true for filename with test suffix and underscore separator', () => {
  assert.equal(isTestPath('src/user_test.js'), true);
});

test('returns true for filename with tests suffix and dot separator', () => {
  assert.equal(isTestPath('src/user.tests.js'), true);
});

test('returns true for filename with tests suffix and dash separator', () => {
  assert.equal(isTestPath('src/user-tests.js'), true);
});

test('returns true for filename with tests suffix and underscore separator', () => {
  assert.equal(isTestPath('src/user_tests.js'), true);
});

test('returns true for filename with spec suffix and dot separator', () => {
  assert.equal(isTestPath('src/user.spec.js'), true);
});

test('returns true for filename with spec suffix and dash separator', () => {
  assert.equal(isTestPath('src/user-spec.js'), true);
});

test('returns true for filename with spec suffix and underscore separator', () => {
  assert.equal(isTestPath('src/user_spec.js'), true);
});

test('returns true for filename with specs suffix and dot separator', () => {
  assert.equal(isTestPath('src/user.specs.js'), true);
});

test('returns true for filename with specs suffix and dash separator', () => {
  assert.equal(isTestPath('src/user-specs.js'), true);
});

test('returns true for filename with specs suffix and underscore separator', () => {
  assert.equal(isTestPath('src/user_specs.js'), true);
});

test('returns true for filename with fixtures suffix and dot separator', () => {
  assert.equal(isTestPath('src/user.fixtures.js'), true);
});

test('returns true for filename with fixtures suffix and dash separator', () => {
  assert.equal(isTestPath('src/user-fixtures.js'), true);
});

test('returns true for filename with fixtures suffix and underscore separator', () => {
  assert.equal(isTestPath('src/user_fixtures.js'), true);
});

test('returns false for filename with similar but non-matching pattern', () => {
  assert.equal(isTestPath('src/user.testing.js'), false);
});

test('returns false for filename with test in middle of name', () => {
  assert.equal(isTestPath('src/mytestfile.js'), false);
});

test('returns false for filename with test as prefix without separator', () => {
  assert.equal(isTestPath('src/testfile.js'), false);
});

test('returns false for filename with test as suffix without separator', () => {
  assert.equal(isTestPath('src/filetest.js'), false);
});

test('returns true for path with trailing slash', () => {
  assert.equal(isTestPath('src/test/'), false);
});

test('returns true for path with leading slash', () => {
  assert.equal(isTestPath('/src/test/foo.js'), true);
});

test('returns false for path with only slashes', () => {
  assert.equal(isTestPath('///'), false);
});

test('returns true for path with multiple test segments', () => {
  assert.equal(isTestPath('src/test/tests/foo.js'), true);
});

test('returns true for path with test and spec segments', () => {
  assert.equal(isTestPath('src/test/spec/foo.js'), true);
});

test('returns true for path with fixtures and test segments', () => {
  assert.equal(isTestPath('src/fixtures/test/foo.js'), true);
});

test('returns false for path with no test-related segments', () => {
  assert.equal(isTestPath('src/lib/utils.js'), false);
});

test('returns true for path with e2e segment in middle', () => {
  assert.equal(isTestPath('src/e2e/tests/login.js'), true);
});

test('returns true for path with mocks segment in middle', () => {
  assert.equal(isTestPath('src/mocks/api/client.js'), true);
});

test('returns true for path with __mocks__ segment in middle', () => {
  assert.equal(isTestPath('src/__mocks__/api/client.js'), true);
});

test('returns true for path with testdata segment in middle', () => {
  assert.equal(isTestPath('src/testdata/users.json'), true);
});

test('returns true for path with test-data segment in middle', () => {
  assert.equal(isTestPath('src/test-data/users.json'), true);
});

test('returns true for path with testing segment in middle', () => {
  assert.equal(isTestPath('src/testing/utils/helpers.js'), true);
});

test('returns true for path with specs segment in middle', () => {
  assert.equal(isTestPath('src/specs/user/profile.js'), true);
});

test('returns false for path with similar but non-matching segment in middle', () => {
  assert.equal(isTestPath('src/testing-tools/utils/helpers.js'), false);
});

test('returns true for path with TEST segment in uppercase in middle', () => {
  assert.equal(isTestPath('src/TEST/foo/bar.js'), true);
});

test('returns true for path with Tests segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/Tests/foo/bar.js'), true);
});

test('returns true for path with Test segment in title case in middle', () => {
  assert.equal(isTestPath('src/Test/foo/bar.js'), true);
});

test('returns true for path with tEST segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/tEST/foo/bar.js'), true);
});

test('returns true for path with tEst segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/tEst/foo/bar.js'), true);
});

test('returns true for path with TeSt segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/TeSt/foo/bar.js'), true);
});

test('returns true for path with tEsT segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/tEsT/foo/bar.js'), true);
});

test('returns true for path with tESTS segment in uppercase in middle', () => {
  assert.equal(isTestPath('src/tESTS/foo/bar.js'), true);
});

test('returns true for path with Tests segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/Tests/foo/bar.js'), true);
});

test('returns true for path with TestS segment in title case in middle', () => {
  assert.equal(isTestPath('src/TestS/foo/bar.js'), true);
});

test('returns true for path with tEstS segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/tEstS/foo/bar.js'), true);
});

test('returns true for path with TeStS segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/TeStS/foo/bar.js'), true);
});

test('returns true for path with tEsTS segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/tEsTS/foo/bar.js'), true);
});

test('returns true for path with __TESTS__ segment in uppercase in middle', () => {
  assert.equal(isTestPath('src/__TESTS__/foo/bar.js'), true);
});

test('returns true for path with __Tests__ segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/__Tests__/foo/bar.js'), true);
});

test('returns true for path with __tEstS__ segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/__tEstS__/foo/bar.js'), true);
});

test('returns true for path with __TeStS__ segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/__TeStS__/foo/bar.js'), true);
});

test('returns true for path with __tEsTS__ segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/__tEsTS__/foo/bar.js'), true);
});

test('returns true for path with SPEC segment in uppercase in middle', () => {
  assert.equal(isTestPath('src/SPEC/foo/bar.js'), true);
});

test('returns true for path with Spec segment in title case in middle', () => {
  assert.equal(isTestPath('src/Spec/foo/bar.js'), true);
});

test('returns true for path with sPEC segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/sPEC/foo/bar.js'), true);
});

test('returns true for path with sPec segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/sPec/foo/bar.js'), true);
});

test('returns true for path with SpEc segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/SpEc/foo/bar.js'), true);
});

test('returns true for path with sPeC segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/sPeC/foo/bar.js'), true);
});

test('returns true for path with SPECS segment in uppercase in middle', () => {
  assert.equal(isTestPath('src/SPECS/foo/bar.js'), true);
});

test('returns true for path with Specs segment in title case in middle', () => {
  assert.equal(isTestPath('src/Specs/foo/bar.js'), true);
});

test('returns true for path with sPECS segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/sPECS/foo/bar.js'), true);
});

test('returns true for path with sPecS segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/sPecS/foo/bar.js'), true);
});

test('returns true for path with SpEcS segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/SpEcS/foo/bar.js'), true);
});

test('returns true for path with sPeCS segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/sPeCS/foo/bar.js'), true);
});

test('returns true for path with FIXTURE segment in uppercase in middle', () => {
  assert.equal(isTestPath('src/FIXTURE/foo/bar.js'), true);
});

test('returns true for path with Fixture segment in title case in middle', () => {
  assert.equal(isTestPath('src/Fixture/foo/bar.js'), true);
});

test('returns true for path with fIXTURE segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/fIXTURE/foo/bar.js'), true);
});

test('returns true for path with fIxTuRe segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/fIxTuRe/foo/bar.js'), true);
});

test('returns true for path with FiXtuRe segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/FiXtuRe/foo/bar.js'), true);
});

test('returns true for path with fIxTuRE segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/fIxTuRE/foo/bar.js'), true);
});

test('returns true for path with FIXTURES segment in uppercase in middle', () => {
  assert.equal(isTestPath('src/FIXTURES/foo/bar.js'), true);
});

test('returns true for path with Fixtures segment in title case in middle', () => {
  assert.equal(isTestPath('src/Fixtures/foo/bar.js'), true);
});

test('returns true for path with fIXTURES segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/fIXTURES/foo/bar.js'), true);
});

test('returns true for path with fIxTuReS segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/fIxTuReS/foo/bar.js'), true);
});

test('returns true for path with FiXtuReS segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/FiXtuReS/foo/bar.js'), true);
});

test('returns true for path with fIxTuRES segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/fIxTuRES/foo/bar.js'), true);
});

test('returns true for path with TESTDATA segment in uppercase in middle', () => {
  assert.equal(isTestPath('src/TESTDATA/foo/bar.js'), true);
});

test('returns true for path with Testdata segment in title case in middle', () => {
  assert.equal(isTestPath('src/Testdata/foo/bar.js'), true);
});

test('returns true for path with tESTDATA segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/tESTDATA/foo/bar.js'), true);
});

test('returns true for path with tEstData segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/tEstData/foo/bar.js'), true);
});

test('returns true for path with TeStData segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/TeStData/foo/bar.js'), true);
});

test('returns true for path with tEsTData segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/tEsTData/foo/bar.js'), true);
});

test('returns true for path with tEsTDaTa segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/tEsTDaTa/foo/bar.js'), true);
});

test('returns true for path with TEST-DATA segment in uppercase in middle', () => {
  assert.equal(isTestPath('src/TEST-DATA/foo/bar.js'), true);
});

test('returns true for path with Test-Data segment in title case in middle', () => {
  assert.equal(isTestPath('src/Test-Data/foo/bar.js'), true);
});

test('returns true for path with tEST-DATA segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/tEST-DATA/foo/bar.js'), true);
});

test('returns true for path with tEst-Data segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/tEst-Data/foo/bar.js'), true);
});

test('returns true for path with TeSt-Data segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/TeSt-Data/foo/bar.js'), true);
});

test('returns true for path with tEsT-Data segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/tEsT-Data/foo/bar.js'), true);
});

test('returns true for path with tEsT-DaTa segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/tEsT-DaTa/foo/bar.js'), true);
});

test('returns true for path with TESTING segment in uppercase in middle', () => {
  assert.equal(isTestPath('src/TESTING/foo/bar.js'), true);
});

test('returns true for path with Testing segment in title case in middle', () => {
  assert.equal(isTestPath('src/Testing/foo/bar.js'), true);
});

test('returns true for path with tESTING segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/tESTING/foo/bar.js'), true);
});

test('returns true for path with tEstING segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/tEstING/foo/bar.js'), true);
});

test('returns true for path with TeStING segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/TeStING/foo/bar.js'), true);
});

test('returns true for path with tEsTINg segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/tEsTINg/foo/bar.js'), true);
});

test('returns true for path with tEsTIng segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/tEsTIng/foo/bar.js'), true);
});

test('returns true for path with tEsTing segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/tEsTing/foo/bar.js'), true);
});

test('returns true for path with MOCKS segment in uppercase in middle', () => {
  assert.equal(isTestPath('src/MOCKS/foo/bar.js'), true);
});

test('returns true for path with Mocks segment in title case in middle', () => {
  assert.equal(isTestPath('src/Mocks/foo/bar.js'), true);
});

test('returns true for path with mOCKS segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/mOCKS/foo/bar.js'), true);
});

test('returns true for path with mOcks segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/mOcks/foo/bar.js'), true);
});

test('returns true for path with MoCks segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/MoCks/foo/bar.js'), true);
});

test('returns true for path with mOcKs segment in mixed case in middle', () => {
  assert.equal(isTestPath('src/mOcKs/foo/bar.js'), true);
});

test('returns true for path with __MOCKS__ segment in uppercase in middle', () => {
  assert.equal(isTestPath('src/__MOCKS__/foo/bar.js'), true);
});
