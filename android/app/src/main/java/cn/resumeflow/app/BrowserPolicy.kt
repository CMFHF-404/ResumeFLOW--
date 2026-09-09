package cn.resumeflow.app

object BrowserPolicy {
    // Current site syntax/APIs and the origin-scoped message bridge need a maintained engine.
    const val MINIMUM_MAJOR = 107
    fun supportsVersion(version: String?): Boolean =
        (version?.substringBefore('.')?.toIntOrNull() ?: 0) >= MINIMUM_MAJOR
}
