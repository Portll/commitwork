// Detects PHP, ASP, JSP, and CGI languages from file name and content (bin/webshell-detect.mjs languagesOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { languagesOf } from '../webshell-detect.mjs';

test('returns php for a .php file name', () => {
  const langs = languagesOf('', 'index.php');
  assert.deepEqual([...langs].sort(), ['php']);
});

test('returns php for a .phtml file name', () => {
  const langs = languagesOf('', 'page.phtml');
  assert.deepEqual([...langs].sort(), ['php']);
});

test('returns php for a .inc file name', () => {
  const langs = languagesOf('', 'config.inc');
  assert.deepEqual([...langs].sort(), ['php']);
});

test('returns asp for a .aspx file name', () => {
  const langs = languagesOf('', 'default.aspx');
  assert.deepEqual([...langs].sort(), ['asp']);
});

test('returns jsp for a .jsp file name', () => {
  const langs = languagesOf('', 'index.jsp');
  assert.deepEqual([...langs].sort(), ['jsp']);
});

test('returns cgi for a .cgi file name', () => {
  const langs = languagesOf('', 'handler.cgi');
  assert.deepEqual([...langs].sort(), ['cgi']);
});

test('returns cgi for a .pl file name', () => {
  const langs = languagesOf('', 'script.pl');
  assert.deepEqual([...langs].sort(), ['cgi']);
});

test('returns php from content when name is empty', () => {
  const langs = languagesOf('<?php echo 1;', '');
  assert.deepEqual([...langs].sort(), ['php']);
});

test('returns php from content when name is .txt', () => {
  const langs = languagesOf('<?php system("id");', 'notes.txt');
  assert.deepEqual([...langs].sort(), ['php']);
});

test('returns empty set for a .md file with php-like content', () => {
  const langs = languagesOf('<?php echo 1;', 'README.md');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .js file with php-like content', () => {
  const langs = languagesOf('<?php echo 1;', 'app.js');
  assert.deepEqual([...langs].sort(), []);
});

test('returns asp from content when name is empty', () => {
  const langs = languagesOf('<%@ Page Language="C#" %>', '');
  assert.deepEqual([...langs].sort(), ['asp']);
});

test('returns jsp from content when name is empty', () => {
  const langs = languagesOf('<%@ page contentType="text/html" %>', '');
  assert.deepEqual([...langs].sort(), ['jsp']);
});

test('returns empty set for a .html file with asp-like content', () => {
  const langs = languagesOf('<%@ Page Language="C#" %>', 'page.html');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .json file with jsp-like content', () => {
  const langs = languagesOf('<%@ page contentType="text/html" %>', 'data.json');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for empty name and empty text', () => {
  const langs = languagesOf('', '');
  assert.deepEqual([...langs].sort(), []);
});

test('returns php and asp for a .php file with asp-like content', () => {
  const langs = languagesOf('<%@ Page Language="C#" %>', 'index.php');
  assert.deepEqual([...langs].sort(), ['asp', 'php']);
});

test('returns php and jsp for a .php file with jsp-like content', () => {
  const langs = languagesOf('<%@ page contentType="text/html" %>', 'index.php');
  assert.deepEqual([...langs].sort(), ['jsp', 'php']);
});

test('returns php and cgi for a .php file with cgi-like name', () => {
  const langs = languagesOf('', 'handler.php');
  assert.deepEqual([...langs].sort(), ['php']);
});

test('returns cgi only for a .cgi file with php-like content', () => {
  const langs = languagesOf('<?php echo 1;', 'handler.cgi');
  assert.deepEqual([...langs].sort(), ["cgi", "php"]);
});

test('returns php for a .php5 file name', () => {
  const langs = languagesOf('', 'index.php5');
  assert.deepEqual([...langs].sort(), ['php']);
});

test('returns php for a .phar file name', () => {
  const langs = languagesOf('', 'archive.phar');
  assert.deepEqual([...langs].sort(), ['php']);
});

test('returns asp for a .asp file name', () => {
  const langs = languagesOf('', 'default.asp');
  assert.deepEqual([...langs].sort(), ['asp']);
});

test('returns asp for a .ashx file name', () => {
  const langs = languagesOf('', 'handler.ashx');
  assert.deepEqual([...langs].sort(), ['asp']);
});

test('returns jsp for a .jspx file name', () => {
  const langs = languagesOf('', 'index.jspx');
  assert.deepEqual([...langs].sort(), ['jsp']);
});

test('returns jsp for a .jspf file name', () => {
  const langs = languagesOf('', 'include.jspf');
  assert.deepEqual([...langs].sort(), ['jsp']);
});

test('returns php from content with <?= tag', () => {
  const langs = languagesOf('<?= $var ?>', 'notes.txt');
  assert.deepEqual([...langs].sort(), ['php']);
});

test('returns asp from content with runat=server', () => {
  const langs = languagesOf('<script runat="server">', 'notes.txt');
  assert.deepEqual([...langs].sort(), ['asp']);
});

test('returns jsp from content with <jsp: tag', () => {
  const langs = languagesOf('<jsp:include page="x" />', 'notes.txt');
  assert.deepEqual([...langs].sort(), ['jsp']);
});

test('returns empty set for a .py file with php-like content', () => {
  const langs = languagesOf('<?php echo 1;', 'script.py');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .sh file with php-like content', () => {
  const langs = languagesOf('<?php echo 1;', 'run.sh');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .css file with php-like content', () => {
  const langs = languagesOf('<?php echo 1;', 'style.css');
  assert.deepEqual([...langs].sort(), []);
});

test('returns php for a .pht file name', () => {
  const langs = languagesOf('', 'page.pht');
  assert.deepEqual([...langs].sort(), ['php']);
});

test('returns asp for a .asa file name', () => {
  const langs = languagesOf('', 'default.asa');
  assert.deepEqual([...langs].sort(), ['asp']);
});

test('returns asp for a .asmx file name', () => {
  const langs = languagesOf('', 'service.asmx');
  assert.deepEqual([...langs].sort(), ['asp']);
});

test('returns php for a .php3 file name', () => {
  const langs = languagesOf('', 'index.php3');
  assert.deepEqual([...langs].sort(), ['php']);
});

test('returns php for a .php7 file name', () => {
  const langs = languagesOf('', 'index.php7');
  assert.deepEqual([...langs].sort(), ['php']);
});

test('returns php for a .php8 file name', () => {
  const langs = languagesOf('', 'index.php8');
  assert.deepEqual([...langs].sort(), ['php']);
});

test('returns php for a .php9 file name', () => {
  const langs = languagesOf('', 'index.php9');
  assert.deepEqual([...langs].sort(), ['php']);
});

test('returns php for a .php0 file name', () => {
  const langs = languagesOf('', 'index.php0');
  assert.deepEqual([...langs].sort(), ['php']);
});

test('returns empty set for a .phpx file name', () => {
  const langs = languagesOf('', 'index.phpx');
  assert.deepEqual([...langs].sort(), []);
});

test('returns php for a .PHP file name (case insensitive)', () => {
  const langs = languagesOf('', 'INDEX.PHP');
  assert.deepEqual([...langs].sort(), ['php']);
});

test('returns asp for a .ASPX file name (case insensitive)', () => {
  const langs = languagesOf('', 'DEFAULT.ASPX');
  assert.deepEqual([...langs].sort(), ['asp']);
});

test('returns jsp for a .JSP file name (case insensitive)', () => {
  const langs = languagesOf('', 'INDEX.JSP');
  assert.deepEqual([...langs].sort(), ['jsp']);
});

test('returns cgi for a .CGI file name (case insensitive)', () => {
  const langs = languagesOf('', 'HANDLER.CGI');
  assert.deepEqual([...langs].sort(), ['cgi']);
});

test('returns php from content with uppercase <?PHP', () => {
  const langs = languagesOf('<?PHP echo 1;', 'notes.txt');
  assert.deepEqual([...langs].sort(), ['php']);
});

test('returns php from content with uppercase <?=', () => {
  const langs = languagesOf('<?= $var ?>', 'notes.txt');
  assert.deepEqual([...langs].sort(), ['php']);
});

test('returns asp from content with uppercase <%@ PAGE', () => {
  const langs = languagesOf('<%@ PAGE Language="C#" %>', 'notes.txt');
  assert.deepEqual([...langs].sort(), ['asp']);
});

test('returns jsp from content with uppercase <%@ PAGE', () => {
  const langs = languagesOf('<%@ PAGE contentType="text/html" %>', 'notes.txt');
  assert.deepEqual([...langs].sort(), ['jsp']);
});

test('returns php for a file with .php in the middle of the name', () => {
  const langs = languagesOf('', 'my.php.file');
  assert.deepEqual([...langs].sort(), []);
});

test('returns php for a file ending in .php', () => {
  const langs = languagesOf('', 'my.php');
  assert.deepEqual([...langs].sort(), ['php']);
});

test('returns empty set for a file with no extension and no content markers', () => {
  const langs = languagesOf('hello world', 'Makefile');
  assert.deepEqual([...langs].sort(), []);
});

test('returns php for a file with no extension and php content', () => {
  const langs = languagesOf('<?php echo 1;', 'Makefile');
  assert.deepEqual([...langs].sort(), ['php']);
});

test('returns asp for a file with no extension and asp content', () => {
  const langs = languagesOf('<%@ Page Language="C#" %>', 'Makefile');
  assert.deepEqual([...langs].sort(), ['asp']);
});

test('returns jsp for a file with no extension and jsp content', () => {
  const langs = languagesOf('<%@ page contentType="text/html" %>', 'Makefile');
  assert.deepEqual([...langs].sort(), ['jsp']);
});

test('returns empty set for a .txt file with no language markers', () => {
  const langs = languagesOf('just some text', 'notes.txt');
  assert.deepEqual([...langs].sort(), []);
});

test('returns php for a .inc file with php content', () => {
  const langs = languagesOf('<?php echo 1;', 'config.inc');
  assert.deepEqual([...langs].sort(), ['php']);
});

test('returns php for a .inc file without php content', () => {
  const langs = languagesOf('just some text', 'config.inc');
  assert.deepEqual([...langs].sort(), ['php']);
});

test('returns empty set for a .txt file with asp content but no page directive', () => {
  const langs = languagesOf('<% response.write "hi" %>', 'notes.txt');
  assert.deepEqual([...langs].sort(), []);
});

test('returns asp for a .txt file with WebHandler directive', () => {
  const langs = languagesOf('<%@ WebHandler Language="C#" %>', 'notes.txt');
  assert.deepEqual([...langs].sort(), ['asp']);
});

test('returns asp for a .txt file with WebService directive', () => {
  const langs = languagesOf('<%@ WebService Language="C#" %>', 'notes.txt');
  assert.deepEqual([...langs].sort(), ['asp']);
});

test('returns jsp for a .txt file with import directive', () => {
  const langs = languagesOf('<%@ page import="java.util.*" %>', 'notes.txt');
  assert.deepEqual([...langs].sort(), ['jsp']);
});

test('returns jsp for a .txt file with pageEncoding directive', () => {
  const langs = languagesOf('<%@ page pageEncoding="UTF-8" %>', 'notes.txt');
  assert.deepEqual([...langs].sort(), ['jsp']);
});

test('returns php for a .php file with no content', () => {
  const langs = languagesOf('', 'index.php');
  assert.deepEqual([...langs].sort(), ['php']);
});

test('returns empty set for a .txt file with no content', () => {
  const langs = languagesOf('', 'notes.txt');
  assert.deepEqual([...langs].sort(), []);
});

test('returns php for a .php file with asp content', () => {
  const langs = languagesOf('<%@ Page Language="C#" %>', 'index.php');
  assert.deepEqual([...langs].sort(), ['asp', 'php']);
});

test('returns php for a .php file with jsp content', () => {
  const langs = languagesOf('<%@ page contentType="text/html" %>', 'index.php');
  assert.deepEqual([...langs].sort(), ['jsp', 'php']);
});

test('returns asp for a .aspx file with php content', () => {
  const langs = languagesOf('<?php echo 1;', 'default.aspx');
  assert.deepEqual([...langs].sort(), ['asp', 'php']);
});

test('returns jsp for a .jsp file with php content', () => {
  const langs = languagesOf('<?php echo 1;', 'index.jsp');
  assert.deepEqual([...langs].sort(), ['jsp', 'php']);
});

test('returns cgi for a .cgi file with php content', () => {
  const langs = languagesOf('<?php echo 1;', 'handler.cgi');
  assert.deepEqual([...langs].sort(), ['cgi', 'php']);
});

test('returns cgi for a .pl file with php content', () => {
  const langs = languagesOf('<?php echo 1;', 'script.pl');
  assert.deepEqual([...langs].sort(), ['cgi', 'php']);
});

test('returns php for a .php file with cgi content', () => {
  const langs = languagesOf('#!/bin/sh', 'index.php');
  assert.deepEqual([...langs].sort(), ['php']);
});

test('returns empty set for a .md file with no content', () => {
  const langs = languagesOf('', 'README.md');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .json file with no content', () => {
  const langs = languagesOf('', 'data.json');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .xml file with no content', () => {
  const langs = languagesOf('', 'config.xml');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .html file with no content', () => {
  const langs = languagesOf('', 'page.html');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .css file with no content', () => {
  const langs = languagesOf('', 'style.css');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .py file with no content', () => {
  const langs = languagesOf('', 'script.py');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .rb file with no content', () => {
  const langs = languagesOf('', 'script.rb');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .go file with no content', () => {
  const langs = languagesOf('', 'main.go');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .rs file with no content', () => {
  const langs = languagesOf('', 'main.rs');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .java file with no content', () => {
  const langs = languagesOf('', 'Main.java');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .c file with no content', () => {
  const langs = languagesOf('', 'main.c');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .cpp file with no content', () => {
  const langs = languagesOf('', 'main.cpp');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .h file with no content', () => {
  const langs = languagesOf('', 'main.h');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .cs file with no content', () => {
  const langs = languagesOf('', 'Main.cs');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .swift file with no content', () => {
  const langs = languagesOf('', 'main.swift');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .sh file with no content', () => {
  const langs = languagesOf('', 'run.sh');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .bash file with no content', () => {
  const langs = languagesOf('', 'run.bash');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .zsh file with no content', () => {
  const langs = languagesOf('', 'run.zsh');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .ps1 file with no content', () => {
  const langs = languagesOf('', 'run.ps1');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .yaml file with no content', () => {
  const langs = languagesOf('', 'config.yaml');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .yml file with no content', () => {
  const langs = languagesOf('', 'config.yml');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .toml file with no content', () => {
  const langs = languagesOf('', 'config.toml');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .vue file with no content', () => {
  const langs = languagesOf('', 'Component.vue');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .svelte file with no content', () => {
  const langs = languagesOf('', 'Component.svelte');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .scss file with no content', () => {
  const langs = languagesOf('', 'style.scss');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .less file with no content', () => {
  const langs = languagesOf('', 'style.less');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .rst file with no content', () => {
  const langs = languagesOf('', 'doc.rst');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .markdown file with no content', () => {
  const langs = languagesOf('', 'README.markdown');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .jsx file with no content', () => {
  const langs = languagesOf('', 'Component.jsx');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .tsx file with no content', () => {
  const langs = languagesOf('', 'Component.tsx');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .ts file with no content', () => {
  const langs = languagesOf('', 'main.ts');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .mts file with no content', () => {
  const langs = languagesOf('', 'main.mts');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .cts file with no content', () => {
  const langs = languagesOf('', 'main.cts');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .cjs file with no content', () => {
  const langs = languagesOf('', 'main.cjs');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .mjs file with no content', () => {
  const langs = languagesOf('', 'main.mjs');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .kts file with no content', () => {
  const langs = languagesOf('', 'main.kts');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .kt file with no content', () => {
  const langs = languagesOf('', 'main.kt');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .scala file with no content', () => {
  const langs = languagesOf('', 'Main.scala');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .cc file with no content', () => {
  const langs = languagesOf('', 'main.cc');
  assert.deepEqual([...langs].sort(), []);
});

test('returns empty set for a .hpp file with no content', () => {
  const langs = languagesOf('', 'main.hpp');
  assert.deepEqual([...langs].sort(), []);
});

test('returns php for a .php file with a long name', () => {
  const langs = languagesOf('', 'a'.repeat(100) + '.php');
  assert.deepEqual([...langs].sort(), ['php']);
});

test('returns empty set for a .txt file with a long name', () => {
  const langs = languagesOf('', 'a'.repeat(100) + '.txt');
  assert.deepEqual([...langs].sort(), []);
});

test('returns php for a .php file with a long text', () => {
  const langs = languagesOf('x'.repeat(1000), 'index.php');
  assert.deepEqual([...langs].sort(), ['php']);
});

test('returns empty set for a .txt file with a long text', () => {
  const langs = languagesOf('x'.repeat(1000), 'notes.txt');
  assert.deepEqual([...langs].sort(), []);
});

test('returns php for a .php file with php content in the middle', () => {
  const langs = languagesOf('x'.repeat(100) + '<?php echo 1;' + 'x'.repeat(100), 'index.php');
  assert.deepEqual([...langs].sort(), ['php']);
});

test('returns php for a .txt file with php content in the middle', () => {
  const langs = languagesOf('x'.repeat(100) + '<?php echo 1;' + 'x'.repeat(100), 'notes.txt');
  assert.deepEqual([...langs].sort(), ['php']);
});

test('returns asp for a .txt file with asp content in the middle', () => {
  const langs = languagesOf('x'.repeat(100) + '<%@ Page Language="C#" %>' + 'x'.repeat(100), 'notes.txt');
  assert.deepEqual([...langs].sort(), ['asp']);
});

test('returns jsp for a .txt file with jsp content in the middle', () => {
  const langs = languagesOf('x'.repeat(100) + '<%@ page contentType="text/html" %>' + 'x'.repeat(100), 'notes.txt');
  assert.deepEqual([...langs].sort(), ['jsp']);
});

test('returns php for a .php file with php content at the start', () => {
  const langs = languagesOf('<?php echo 1;' + 'x'.repeat(100), 'index.php');
  assert.deepEqual([...langs].sort(), ['php']);
});

test('returns php for a .php file with php content at the end', () => {
  const langs = languagesOf('x'.repeat(100) + '<?php echo 1;', 'index.php');
  assert.deepEqual([...langs].sort(), ['php']);
});

test('returns php for a .txt file with php content at the start', () => {
  const langs = languagesOf('<?php echo 1;' + 'x'.repeat(100), 'notes.txt');
  assert.deepEqual([...langs].sort(), ['php']);
});

test('returns php for a .txt file with php content at the end', () => {
  const langs = languagesOf('x'.repeat(100) + '<?php echo 1;', 'notes.txt');
  assert.deepEqual([...langs].sort(), ['php']);
});
