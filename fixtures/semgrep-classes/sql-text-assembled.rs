// Annotated fixture for manifests/semgrep-classes/sql-text-assembled.yaml.
fn cursor_open(conn: &mut Conn, cursor: &str, prepared: &str, hold: &str) {
    // ruleid: cw-sql-text-assembled-rust
    let text = format!("DECLARE {cursor} CURSOR{hold} FOR {}", prepared);
    conn.open(&text);
}

fn message_naming_a_verb(sqlcode: i32) -> String {
    // ok: cw-sql-text-assembled-rust, cw-sql-value-interpolated-rust
    format!("SYNCPOINT ROLLBACK: the database refused to roll back with SQLCODE {}", sqlcode)
}

fn listing_line(file: &str) -> String {
    // ok: cw-sql-text-assembled-rust
    format!("DELETE {file}")
}

fn prose(dir: &str, name: &str) -> (String, String) {
    // ok: cw-sql-text-assembled-rust
    let a = format!("Select a file from {dir} to continue");
    // ok: cw-sql-text-assembled-rust
    let b = format!("create user {name}");
    (a, b)
}

fn constant_statement(conn: &mut Conn) {
    // ok: cw-sql-text-assembled-rust, cw-sql-value-interpolated-rust
    conn.simple("ROLLBACK TO SAVEPOINT ironwork; RELEASE SAVEPOINT ironwork");
}

fn parameterised(conn: &mut Conn, name: &str) {
    // ok: cw-sql-text-assembled-rust, cw-sql-value-interpolated-rust
    conn.query("SELECT id FROM users WHERE name = $1", &[&name]);
}

fn value_in_quotes(conn: &mut Conn, name: &str) {
    // ruleid: cw-sql-text-assembled-rust, cw-sql-value-interpolated-rust
    conn.simple_query(&format!("SELECT * FROM users WHERE name = '{}'", name));
}

fn value_after_comparison(client: &mut Client, table: &str, id: i64) {
    // ruleid: cw-sql-text-assembled-rust, cw-sql-value-interpolated-rust
    let sql = format!("DELETE FROM {table} WHERE id = {id}");
    client.execute(&sql, &[]);
}

fn identifier_only(conn: &mut Conn, column: &str) {
    // ruleid: cw-sql-text-assembled-rust
    // ok: cw-sql-value-interpolated-rust
    let sql = format!("SELECT {column} FROM t");
    conn.prepare(&sql);
}

fn generated_placeholders(conn: &mut Conn, marks: &str, n: usize) {
    // ruleid: cw-sql-text-assembled-rust
    // ok: cw-sql-value-interpolated-rust
    let a = format!("SELECT id FROM plans WHERE status IN ({marks}) ORDER BY id");
    // ruleid: cw-sql-text-assembled-rust
    // ok: cw-sql-value-interpolated-rust
    let b = format!("SELECT id FROM plans WHERE id = ${n}");
    conn.prepare(&a);
    conn.prepare(&b);
}

fn escaped_braces_only() -> String {
    // ok: cw-sql-text-assembled-rust, cw-sql-value-interpolated-rust
    format!("SELECT '{{}}' FROM dual")
}

fn concatenated(conn: &mut Conn, name: &str) {
    // ruleid: cw-sql-text-assembled-rust
    let mut s = String::from("UPDATE accounts SET owner = ");
    s.push_str(name);
    conn.execute(&s, &[]);
}

fn formatted_error(e: &str) -> String {
    // ok: cw-sql-text-assembled-rust
    format!("unrecognized CREATE statement: {e}")
}

#[cfg(test)]
mod tests {
    fn builds_rows(id: i64) -> String {
        // ok: cw-sql-text-assembled-rust, cw-sql-value-interpolated-rust
        format!("INSERT INTO t VALUES ({id}, 'w_{id}', NULL)")
    }
}

fn quote_parity(name_cond: &str, pgno: u32, pattern: &str, safe_name: &str) {
    // ruleid: cw-sql-text-assembled-rust
    // ok: cw-sql-value-interpolated-rust
    let a = format!("SELECT n.nspname FROM pg_type t WHERE t.typtype = 'd' AND {name_cond} ORDER BY 1");
    // ruleid: cw-sql-text-assembled-rust
    // ok: cw-sql-value-interpolated-rust
    let b = format!("SELECT v FROM {META_TABLE} WHERE k = '{META_KEY}'");
    // ruleid: cw-sql-text-assembled-rust, cw-sql-value-interpolated-rust
    let c = format!("SELECT pgno, data FROM sqlite_dbpage WHERE pgno = {pgno}");
    // ruleid: cw-sql-text-assembled-rust, cw-sql-value-interpolated-rust
    let d = format!("SELECT name FROM sqlite_schema WHERE type in ('table', 'view') AND name LIKE '{pattern}' ORDER BY 1");
    // ruleid: cw-sql-text-assembled-rust, cw-sql-value-interpolated-rust
    let e = format!("SELECT a.attname FROM pg_attribute a WHERE c.relname = '{safe_name}' AND a.attnum > 0");
    use_all(&[a, b, c, d, e]);
}

fn ddl_messages(e: &str, table: &str) {
    // ok: cw-sql-text-assembled-rust
    let a = format!("create table failed: {e}");
    // ok: cw-sql-text-assembled-rust
    let b = format!("drop table failed: {e}");
    // ruleid: cw-sql-text-assembled-rust
    let c = format!("DROP TABLE IF EXISTS \"{table}\"");
    // ruleid: cw-sql-text-assembled-rust
    let d = format!("CREATE TABLE IF NOT EXISTS {table} (id INTEGER)");
    use_all(&[a, b, c, d]);
}
