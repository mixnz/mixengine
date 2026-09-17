//! What MixEngine knows about a JDK that the index does not say — roadmap task **T27e**.

/// The variables a JVM reads before its own arguments, removed from every JVM the daemon starts
/// for itself — the design's D3. A malformed `_JAVA_OPTIONS` in the daemon's own environment would
/// otherwise fail every JDK's install for a reason that has nothing to do with the JDK.
pub const UNSET: &[&str] = &[
    "JAVA_TOOL_OPTIONS",
    "_JAVA_OPTIONS",
    "JDK_JAVA_OPTIONS",
    "CLASSPATH",
    "JAVA_HOME",
];
