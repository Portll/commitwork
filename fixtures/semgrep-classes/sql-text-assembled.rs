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
    // ok: cw-sql-text-assembled-rust-nested, cw-sql-value-interpolated-rust-nested
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
    // ok: cw-sql-text-assembled-rust
    // ok: cw-sql-value-interpolated-rust
    let a = format!("SELECT id FROM plans WHERE status IN ({marks}) ORDER BY id");
    // ok: cw-sql-text-assembled-rust
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

    fn builds_nested_rows(id: i64) -> Vec<String> {
        // ok: cw-sql-text-assembled-rust-nested, cw-sql-value-interpolated-rust-nested
        vec![format!("INSERT INTO t VALUES ({id}, 'w_{id}', NULL)")]
    }
}

#[test]
fn nested_in_a_test_fn() {
    let id = 7;
    // ok: cw-sql-text-assembled-rust-nested, cw-sql-value-interpolated-rust-nested
    assert_eq!(vec![format!("DELETE FROM t WHERE id = {id}")].len(), 1);
}

fn quote_parity(name_cond: &str, pgno: u32, pattern: &str, safe_name: &str) {
    // ruleid: cw-sql-text-assembled-rust
    // ok: cw-sql-value-interpolated-rust
    let a = format!("SELECT n.nspname FROM pg_type t WHERE t.typtype = 'd' AND {name_cond} ORDER BY 1");
    // ok: cw-sql-text-assembled-rust
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

// format! calls Semgrep does not parse as calls: nested in another macro, or with a non-trivial
// argument. Only the -nested rules see these lines.
fn nested_in_macros(conn: &mut Conn, name: &str, id: i64, table: &str, column: &str) {
    let batch = vec![
        // ruleid: cw-sql-text-assembled-rust-nested, cw-sql-value-interpolated-rust-nested
        format!("UPDATE accounts SET owner = '{name}' WHERE id = {id}"),
        // ruleid: cw-sql-text-assembled-rust-nested
        // ok: cw-sql-value-interpolated-rust-nested
        format!("SELECT {column} FROM t"),
    ];
    // ruleid: cw-sql-text-assembled-rust-nested, cw-sql-value-interpolated-rust-nested
    log_info!("{}", format!("DELETE FROM {table} WHERE id = {id}"));
    // ruleid: cw-sql-text-assembled-rust-nested, cw-sql-value-interpolated-rust-nested
    let body = json!({ "q": format!("SELECT * FROM users WHERE name = '{}'", name) });
    // ruleid: cw-sql-text-assembled-rust-nested, cw-sql-value-interpolated-rust-nested
    let limited = format!("{} LIMIT 1", format!("SELECT id FROM t WHERE k = {id}"));
    conn.batch(&batch, &body, &limited);
}

fn non_trivial_arguments(conn: &mut Conn, name: &str, ids: &[String]) {
    // ruleid: cw-sql-text-assembled-rust-nested, cw-sql-value-interpolated-rust-nested
    let a = format!("SELECT * FROM users WHERE name = '{}'", name.trim());
    // ruleid: cw-sql-text-assembled-rust-nested, cw-sql-value-interpolated-rust-nested
    let b = format!("DELETE FROM jobs WHERE id IN ({})", ids.join(", "));
    conn.simple_query(&a);
    conn.simple_query(&b);
}

fn nested_exclusions(marks: &str, dir: &str, e: &str, table: &str, sqlcode: i32) {
    let v = vec![
        // ok: cw-sql-text-assembled-rust-nested
        // ok: cw-sql-value-interpolated-rust-nested
        format!("SELECT id FROM plans WHERE status IN ({marks}) ORDER BY id"),
        // ok: cw-sql-text-assembled-rust-nested
        // ok: cw-sql-value-interpolated-rust-nested
        format!("SELECT v FROM {META_TABLE} WHERE k = '{META_KEY}'"),
        // ok: cw-sql-text-assembled-rust-nested, cw-sql-value-interpolated-rust-nested
        format!("SYNCPOINT ROLLBACK: the database refused to roll back with SQLCODE {}", sqlcode),
        // ok: cw-sql-text-assembled-rust-nested
        format!("Select a file from {dir} to continue"),
        // ok: cw-sql-text-assembled-rust-nested
        format!("create table failed: {e}"),
        // ruleid: cw-sql-text-assembled-rust-nested
        format!("DROP TABLE IF EXISTS \"{table}\""),
        // ok: cw-sql-text-assembled-rust-nested, cw-sql-value-interpolated-rust-nested
        format!("SELECT '{{}}' FROM dual"),
    ];
    // ok: cw-sql-text-assembled-rust-nested, cw-sql-value-interpolated-rust-nested
    let n = v.len(); // vec![format!("SELECT * FROM t WHERE id = {n}")]
    use_all(&v, n);
}

// Interpolations that are fixed by construction are not assembled from data: an ALL_CAPS column
// list, a placeholder list, a numbered placeholder. The same statement with an argument in the
// same position is the audit finding.
fn const_columns(conn: &mut Conn, id: i64) {
    // ok: cw-sql-text-assembled-rust, cw-sql-value-interpolated-rust
    let sql = format!("SELECT {COLUMNS} FROM inbox_items WHERE id = ?1");
    conn.prepare(&sql);
    // ok: cw-sql-text-assembled-rust, cw-sql-value-interpolated-rust
    let insert = format!("INSERT OR IGNORE INTO table_row({ROW_COLS}) VALUES (?1, ?2, ?3)");
    conn.prepare(&insert);
}

fn columns_from_argument(conn: &mut Conn, columns: &str) {
    // ruleid: cw-sql-text-assembled-rust
    let sql = format!("SELECT {columns} FROM inbox_items");
    conn.prepare(&sql);
}

fn numbered_and_listed_placeholders(conn: &mut Conn, ids: &[i64]) {
    let placeholders = vec!["?"; ids.len()].join(", ");
    // ok: cw-sql-text-assembled-rust, cw-sql-value-interpolated-rust
    let a = format!("DELETE FROM statement_dynamics WHERE statement_id IN ({placeholders})");
    // ok: cw-sql-text-assembled-rust
    let b = format!("SELECT id FROM t WHERE conversation_id = ?{}", ids.len());
    conn.prepare(&a);
    conn.prepare(&b);
}

// A column name that an assert restricts to a fixed set is an allow-listed identifier. The guard
// has to name the interpolated variable: a guard on another name does not clear it.
fn bump(conn: &Connection, day: &str, column: &str) {
    debug_assert!(matches!(column, "llm_calls" | "input_chars" | "proposals"));
    // ok: cw-sql-text-assembled-rust, cw-sql-value-interpolated-rust
    conn.execute(&format!(
        "INSERT INTO usage(day, {column}) VALUES (?1, ?2)
         ON CONFLICT(day) DO UPDATE SET {column} = {column} + excluded.{column}"
    ), params![day, 1]);
}

fn bump_guard_on_another_name(conn: &Connection, day: &str, column: &str, other: &str) {
    debug_assert!(matches!(other, "llm_calls" | "input_chars"));
    // ruleid: cw-sql-text-assembled-rust, cw-sql-value-interpolated-rust
    conn.execute(&format!(
        "INSERT INTO usage(day, {column}) VALUES (?1, ?2)
         ON CONFLICT(day) DO UPDATE SET {column} = {column} + excluded.{column}"
    ), params![day, 1]);
}

// A direction chosen by a match whose arms are all string literals is not data.
fn ordered(conn: &Connection, newest_first: bool, direction: &str) {
    let dir = match newest_first {
        true => "DESC",
        false => "ASC",
    };
    // ok: cw-sql-text-assembled-rust
    let a = format!("SELECT id FROM audit_events ORDER BY id {dir}");
    // ruleid: cw-sql-text-assembled-rust
    let b = format!("SELECT id FROM audit_events ORDER BY id {direction}");
    conn.prepare(&a);
    conn.prepare(&b);
}

// A name derived from a constant is a constant.
fn columns_from_a_constant(conn: &Connection, filter: &str) {
    let columns = COLUMNS
        .split(", ")
        .map(|c| format!("v.{}", c.trim()))
        .collect::<Vec<_>>()
        .join(", ");
    // ok: cw-sql-text-assembled-rust
    let a = format!("SELECT {columns} FROM generated_visuals v");
    // ruleid: cw-sql-text-assembled-rust
    let b = format!("SELECT {filter} FROM generated_visuals v");
    conn.prepare(&a);
    conn.prepare(&b);
}

// A WHERE clause joined from fragments whose values are bound with params_from_iter. The same
// clause without that binding, or a clause taken from the caller, is not cleared.
fn listed(conn: &Connection, filters: Vec<String>, args: Vec<SqlValue>) {
    let filter = filters.join(" AND ");
    // ok: cw-sql-text-assembled-rust
    let n: i64 = conn.query_row(
        &format!("SELECT count(*) FROM generated_visuals v WHERE {filter}"),
        params_from_iter(args.iter()),
        |r| r.get(0),
    );
}

fn listed_unbound(conn: &Connection, filters: Vec<String>) {
    let filter = filters.join(" AND ");
    // ruleid: cw-sql-text-assembled-rust
    let n: i64 = conn.query_row(&format!("SELECT count(*) FROM generated_visuals v WHERE {filter}"), [], |r| r.get(0));
}

fn clause_from_a_builder(conn: &Connection, q: &Query) {
    let (filter, params) = filter_sql(q);
    // ok: cw-sql-text-assembled-rust
    let sql = format!("SELECT id FROM audit_events{filter} ORDER BY id");
    conn.prepare(&sql).query(params_from_iter(params));
}

fn clause_from_the_request(conn: &Connection, q: &Query) {
    let filter = q.filter.clone();
    // ruleid: cw-sql-text-assembled-rust
    let sql = format!("SELECT id FROM audit_events{filter} ORDER BY id");
    conn.prepare(&sql).query([]);
}

// A quoted list of an enum's fixed labels (a Type::fn(..) call) is not data. The same list
// built from a slice the caller handed in is.
fn status_list(conn: &Connection, event: Event, names: &[String]) {
    let sources = ProposalStatus::sources(event)
        .iter()
        .map(|s| format!("'{}'", s.as_str()))
        .collect::<Vec<_>>()
        .join(", ");
    // ok: cw-sql-text-assembled-rust, cw-sql-value-interpolated-rust
    let a = format!("UPDATE proposals SET status = ?1 WHERE id = ?2 AND status IN ({sources})");
    let listed = names
        .iter()
        .map(|s| format!("'{}'", s.as_str()))
        .collect::<Vec<_>>()
        .join(", ");
    // ruleid: cw-sql-text-assembled-rust, cw-sql-value-interpolated-rust
    let b = format!("UPDATE proposals SET status = ?1 WHERE id = ?2 AND status IN ({listed})");
    conn.execute(&a, []);
    conn.execute(&b, []);
}

// The same exclusions apply to a format! the parser reads as a token tree.
fn nested_fixed(day: &str, column: &str, id: i64) {
    debug_assert!(matches!(column, "llm_calls" | "proposals"));
    let v = vec![
        // ok: cw-sql-text-assembled-rust-nested, cw-sql-value-interpolated-rust-nested
        format!("UPDATE usage SET {column} = {column} + 1 WHERE day = ?1"),
        // ok: cw-sql-text-assembled-rust-nested
        format!("SELECT {COLUMNS} FROM inbox_items WHERE id = ?1").trim(),
    ];
    run(&v, day, id);
}

fn nested_from_argument(table: &str) {
    let v = vec![
        // ruleid: cw-sql-text-assembled-rust-nested
        format!("SELECT id FROM {table}"),
    ];
    run(&v);
}

// Test code is out of scope for the Rust SQL rules.
#[cfg(test)]
mod sql_checks {
    fn builds(conn: &Connection, table: &str) {
        // ok: cw-sql-text-assembled-rust
        let sql = format!("SELECT id FROM {table}");
        conn.prepare(&sql);
    }
}
