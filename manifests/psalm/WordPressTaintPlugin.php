<?php
// Loaded by the sast-php-psalm lane beside wordpress-taint.phpstub. Psalm's `input` source carries
// only psalm's own kinds, so a stub sink of a WordPress kind never fired on a superglobal read
// (measured 2026-11-12). This adds those kinds where the request enters, and removes them where a
// literal prefix already decides what the request can choose.

namespace Commitwork\Psalm;

use PhpParser\Node\Expr;
use PhpParser\Node\Expr\BinaryOp\Concat;
use PhpParser\Node\Expr\Variable;
use PhpParser\Node\InterpolatedStringPart;
use PhpParser\Node\Scalar\InterpolatedString;
use PhpParser\Node\Scalar\String_;
use Psalm\Plugin\EventHandler\AddTaintsInterface;
use Psalm\Plugin\EventHandler\Event\AddRemoveTaintsEvent;
use Psalm\Plugin\EventHandler\RemoveTaintsInterface;

// The Homebrew psalm phar scopes php-parser under `PsalmPhar\`; composer's psalm does not.
foreach ([
    'PhpParser\Node\Expr',
    'PhpParser\Node\Expr\BinaryOp\Concat',
    'PhpParser\Node\Expr\Variable',
    'PhpParser\Node\InterpolatedStringPart',
    'PhpParser\Node\Scalar\InterpolatedString',
    'PhpParser\Node\Scalar\String_',
] as $phpParserClass) {
    if (!class_exists($phpParserClass, false) && class_exists('PsalmPhar\\' . $phpParserClass)) {
        class_alias('PsalmPhar\\' . $phpParserClass, $phpParserClass);
    }
}

final class WordPressTaintPlugin implements AddTaintsInterface, RemoveTaintsInterface
{
    public const KINDS = ['wp_option_key', 'wp_redirect'];

    // $_SERVER and $_FILES are absent: the event sees the whole variable and not the key, and most of
    // their keys are the server's own.
    private const REQUEST_SUPERGLOBALS = ['_GET', '_POST', '_COOKIE', '_REQUEST'];

    public static function addTaints(AddRemoveTaintsEvent $event): array
    {
        $expr = $event->getExpr();
        if ($expr instanceof Variable
            && is_string($expr->name)
            && in_array($expr->name, self::REQUEST_SUPERGLOBALS, true)
            && !self::dispatchedByArrayFetch()
        ) {
            return self::KINDS;
        }
        return [];
    }

    // Psalm 6.19.1 dispatches this for `$_POST` in `$_POST['k']` twice: the variable fetch merges the kinds into
    // psalm's own input source, and the array fetch makes a second source from them, so every flow was reported
    // twice (measured 2026-11-13). Should the class move, the duplicates return and the lane test fails on them.
    private static function dispatchedByArrayFetch(): bool
    {
        foreach (debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 4) as $frame) {
            if (str_ends_with($frame['class'] ?? '', '\\ArrayFetchAnalyzer')) {
                return true;
            }
        }
        return false;
    }

    public static function removeTaints(AddRemoveTaintsEvent $event): array
    {
        $prefix = self::literalPrefix($event->getExpr());
        if ($prefix === null || $prefix === '') {
            return [];
        }
        // Any fixed prefix confines an option name to the plugin's own namespace; only some confine a URL.
        return self::pinsOrigin($prefix) ? ['wp_option_key', 'wp_redirect', 'ssrf'] : ['wp_option_key'];
    }

    private static function literalPrefix(Expr $expr): ?string
    {
        if ($expr instanceof Concat) {
            return self::literalPrefix($expr->left);
        }
        if ($expr instanceof String_) {
            return $expr->value;
        }
        if ($expr instanceof InterpolatedString && ($expr->parts[0] ?? null) instanceof InterpolatedStringPart) {
            return $expr->parts[0]->value;
        }
        return null;
    }

    private static function pinsOrigin(string $prefix): bool
    {
        // The host must be terminated, or `http://a.example` . `.evil.example` and `@evil.example` move it.
        return preg_match('~^[a-z][a-z0-9+.\-]*://[^/?#\\\\@]+[/?#]~i', $prefix) === 1
            // `/` alone is not enough: `/` . `/evil.example` is protocol-relative.
            || preg_match('~^/[^/\\\\]~', $prefix) === 1
            // A relative path pins the origin once a `/`, `?` or `#` precedes any `:` that could open a scheme.
            || preg_match('~^[^/\\\\:?#]+/|^[^/\\\\:?#]*[?#]~', $prefix) === 1;
    }
}
