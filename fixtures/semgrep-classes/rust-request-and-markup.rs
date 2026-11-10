// Annotated fixture for manifests/semgrep-classes/rust-request-and-markup.yaml.
use std::io::Write;

const API_BASE: &str = "https://api.example.test";

// ---- cw-ssrf-url-assembled-rust ----

async fn base_and_id(client: &reqwest::Client, base: &str, id: &str) {
    // ruleid: cw-ssrf-url-assembled-rust
    let r = client.get(format!("{}/v1/items/{}", base, id)).send().await;
}

async fn bound_first(http: &reqwest::Client, host: &str) {
    let url = format!("https://{host}/status");
    // ruleid: cw-ssrf-url-assembled-rust
    let r = reqwest::get(&url).await;
}

fn blocking(host: &str, port: u16) {
    // ruleid: cw-ssrf-url-assembled-rust
    let r = reqwest::blocking::get(format!("http://{}:{}/health", host, port));
}

fn ureq_call(base: &str, name: &str) {
    // ruleid: cw-ssrf-url-assembled-rust
    let r = ureq::get(&format!("{}/api/{}", base, name)).call();
}

async fn surf_post(base: &str, body: String) {
    // ruleid: cw-ssrf-url-assembled-rust
    let r = surf::post(format!("{base}/upload")).body(body).await;
}

fn hyper_builder(addr: &str) {
    let req = Request::builder()
        .method(Method::GET)
        // ruleid: cw-ssrf-url-assembled-rust
        .uri(format!("http://{}/metrics", addr))
        .body(Body::empty());
}

fn uri_parse(authority: &str) {
    // ruleid: cw-ssrf-url-assembled-rust
    let uri = format!("http://{}/probe", authority).parse::<Uri>();
}

struct Api { http: reqwest::Client, base_url: String }

impl Api {
    async fn user(&self, user_id: &str) {
        let url = format!("{}/api/users/{}", self.base_url, user_id);
        // ruleid: cw-ssrf-url-assembled-rust
        let r = self.http.post(&url).json(&user_id).send().await;
    }

    async fn delete(&self, id: u64) {
        // ruleid: cw-ssrf-url-assembled-rust
        let r = self.http.request(Method::DELETE, format!("{}/items/{}", self.base_url, id)).send().await;
    }

    async fn deferred(&self, owner: &str) {
        // ruleid: cw-ssrf-url-assembled-rust
        let req = self.http.get(format!("https://code.example.test/repos/{owner}"));
        let r = req.send().await;
    }

    async fn concatenated(&self, id: &str) {
        let url = self.base_url.clone() + "/v1/items/" + id;
        // ruleid: cw-ssrf-url-assembled-rust
        let r = self.http.get(&url).send().await;
    }
}

async fn call_argument(client: &reqwest::Client, cfg: &Config, id: &str) {
    // ruleid: cw-ssrf-url-assembled-rust
    let r = client.get(format!("{}/v1/items/{}", cfg.base_url(), id)).send().await;
}

fn named_argument(resolved: &Path) {
    // ruleid: cw-ssrf-url-assembled-rust
    let r = ureq::get(&format!("https://files.example.test/{p}", p = resolved.display())).call();
}

struct Embedder { pool: ureq::Agent, base_url: String, key: Option<String> }

impl Embedder {
    fn probe(&self) {
        let models_url = format!("{}/v1/models", self.base_url);
        // ruleid: cw-ssrf-url-assembled-rust
        let mut builder = self.pool.get(&models_url);
        if let Some(ref key) = self.key {
            builder = builder.set("Authorization", key);
        }
        match builder.call() {
            Ok(_) => {}
            Err(_) => {}
        }
    }
}

fn typed_uri(endpoint: &str, table: &str) {
    let url = format!("{}/api/tables/{}", endpoint, table);
    // ruleid: cw-ssrf-url-assembled-rust
    let uri: Uri = url.parse().unwrap();
}

async fn literal(client: &reqwest::Client) {
    // ok: cw-ssrf-url-assembled-rust
    let r = client.get("https://api.example.test/v1/status").send().await;
}

async fn constants_only(client: &reqwest::Client) {
    // ok: cw-ssrf-url-assembled-rust
    let a = client.get(format!("{}/v1/status", API_BASE)).send().await;
    // ok: cw-ssrf-url-assembled-rust
    let b = client.get(format!("{API_BASE}/v1/health")).send().await;
    // ok: cw-ssrf-url-assembled-rust
    let c = client.get(format!("{}/v1/version", env!("SERVICE_BASE"))).send().await;
}

async fn whole_url_passed_through(client: &reqwest::Client, url: &str) {
    // ok: cw-ssrf-url-assembled-rust
    let r = client.get(format!("{}", url)).send().await;
}

fn not_a_request(map: &HashMap<String, u32>, store: &Store, dir: &str, name: &str) {
    // ok: cw-ssrf-url-assembled-rust
    let a = map.get(&format!("{}/{}", dir, name));
    // ok: cw-ssrf-url-assembled-rust
    let b = store.kv_client.get(format!("{}/{}", dir, name));
}

#[cfg(test)]
mod tests {
    async fn local_server(client: &reqwest::Client, addr: &str) {
        // ok: cw-ssrf-url-assembled-rust
        let r = client.post(format!("http://{addr}/ingest")).send().await;
    }
}

#[cfg(all(test, feature = "integration"))]
#[allow(dead_code)]
pub mod integration_checks {
    async fn sink_round_trip(client: &reqwest::Client, endpoint: &str) {
        // ok: cw-ssrf-url-assembled-rust
        let r = client.get(format!("{endpoint}/query")).send().await;
    }
}

#[tokio::test]
async fn health_endpoint(client: &reqwest::Client, port: u16) {
    // ok: cw-ssrf-url-assembled-rust
    let r = client.get(format!("http://127.0.0.1:{port}/health")).send().await;
}

async fn after_the_test_modules(client: &reqwest::Client, base: &str, key: &str) {
    // ruleid: cw-ssrf-url-assembled-rust
    let r = client.get(format!("{base}/objects/{key}")).send().await;
}

// ---- cw-html-assembled-rust ----

async fn greet(name: String) -> Html<String> {
    // ruleid: cw-html-assembled-rust
    Html(format!("<p>Hello, {}</p>", name))
}

async fn profile(name: String) -> Html<String> {
    let body = format!(r#"<div class="user">{name}</div>"#);
    // ruleid: cw-html-assembled-rust
    Html(body)
}

fn actix_title(title: &str) -> HttpResponse {
    // ruleid: cw-html-assembled-rust
    HttpResponse::Ok().content_type("text/html").body(format!("<h1>{}</h1>", title))
}

fn hyper_link(next: &str) -> Response<Body> {
    let page = format!("<a href=\"{}\">next</a>", next);
    // ruleid: cw-html-assembled-rust
    Response::builder().header("content-type", "text/html").body(Body::from(page)).unwrap()
}

fn listing(items: &[String]) -> Html<String> {
    let mut html = String::from("<ul>");
    for item in items {
        html.push_str(&format!("<li>{}</li>", item));
    }
    html.push_str("</ul>");
    // ruleid: cw-html-assembled-rust
    Html(html)
}

fn table(cells: &[String]) -> Html<String> {
    let mut out = String::new();
    for cell in cells {
        write!(out, "<td>{}</td>", cell).unwrap();
    }
    // ruleid: cw-html-assembled-rust
    Html(out)
}

fn raw_pushes(label: &str) -> Html<String> {
    let mut s = String::new();
    s.push_str("<span class=\"label\">");
    s.push_str(label);
    s.push_str("</span>");
    // ruleid: cw-html-assembled-rust
    Html(s)
}

fn concatenated(note: &str) -> Html<String> {
    // ruleid: cw-html-assembled-rust
    Html("<pre>".to_string() + note + "</pre>")
}

fn own_server(stream: &mut TcpStream, message: &str) {
    let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html><body>{message}</body></html>");
    // ruleid: cw-html-assembled-rust
    stream.write_all(response.as_bytes()).unwrap();
}

fn tiny(config_json: &str) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    // ruleid: cw-html-assembled-rust
    tiny_http::Response::from_string(format!("<script>window.cfg = {};</script>", config_json))
}

fn call_argument_html(user: &User) -> Html<String> {
    // ruleid: cw-html-assembled-rust
    Html(format!("<span>{}</span>", user.display_name()))
}

fn named_argument_html(dir: &Path) -> Html<String> {
    let body = format!("<p>Serving <code>{d}</code></p>", d = dir.display());
    // ruleid: cw-html-assembled-rust
    Html(body)
}

fn rows_with_calls(cells: &[Cell]) -> Html<String> {
    let mut out = String::new();
    for cell in cells {
        let _ = writeln!(out, "<td>{}</td>", cell.label());
    }
    // ruleid: cw-html-assembled-rust
    Html(out)
}

fn escaped_call(user: &User) -> Html<String> {
    // ok: cw-html-assembled-rust
    Html(format!("<span>{}</span>", encode_text(&user.display_name())))
}

fn code_listing(ty: &str) -> Html<String> {
    // ok: cw-html-assembled-rust
    Html(format!("impl<B: Block> Eq for Wrapper<B> where <I as Iterator>::Item: {}", ty))
}

fn escaped(name: &str, bio: &str) -> Html<String> {
    // ok: cw-html-assembled-rust
    let a = Html(format!("<p>{}</p>", html_escape::encode_text(name)));
    // ok: cw-html-assembled-rust
    let b = Html(format!("<p>{}</p>", escape(bio)));
    let escaped_name = escape(name);
    // ok: cw-html-assembled-rust
    Html(format!("<b>{escaped_name}</b>"))
}

fn constant_markup() -> Html<String> {
    // ok: cw-html-assembled-rust
    Html(format!("<p>{}</p>", GREETING))
}

fn no_markup(name: &str) -> Html<String> {
    // ok: cw-html-assembled-rust
    Html(format!("Hello {name}, usage: prog <table>"))
}

fn written_to_a_file(path: &Path, rows: &str) {
    // ok: cw-html-assembled-rust
    std::fs::write(path, format!("<table>{}</table>", rows)).unwrap();
}

fn templated(t: &ProfileTemplate) -> Html<String> {
    // ok: cw-html-assembled-rust
    Html(t.render().unwrap())
}

#[cfg(test)]
mod test {
    fn renders(name: &str) -> Html<String> {
        // ok: cw-html-assembled-rust
        Html(format!("<p>{name}</p>"))
    }
}

// A fixed prefix and a path is not an assembled URL: a format string that is two interpolations and
// opens with a field of self, or a `base` the function bound with its own let. A prefix handed in as
// a parameter, or named anything else, still is.
struct Connector { client: reqwest::Client, base: String, base_url: String }

impl Connector {
    async fn authorized(&self, path: &str) {
        // ok: cw-ssrf-url-assembled-rust
        let r = self.client.post(format!("{}{path}", self.base)).header("Accept", "application/json").send().await;
    }

    async fn named_field_then_literal_path(&self, id: u64) {
        // ruleid: cw-ssrf-url-assembled-rust
        let r = self.client.post(format!("{}/items/{id}", self.base_url)).send().await;
    }

    async fn host_from_a_parameter(&self, host: &str, path: &str) {
        // ruleid: cw-ssrf-url-assembled-rust
        let r = self.client.post(format!("{host}{path}")).send().await;
    }
}

async fn probe(configured: &str) {
    let base = configured.trim().trim_end_matches('/');
    // ok: cw-ssrf-url-assembled-rust
    let r = client.get(format!("{base}/models")).header("Accept", "application/json").send().await;
}

async fn probe_host_from_a_parameter(base: &str) {
    // ruleid: cw-ssrf-url-assembled-rust
    let r = client.get(format!("{base}/models")).header("Accept", "application/json").send().await;
}
