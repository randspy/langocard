package com.randspy.langocard

enum class LibraryTool { Add, Packs, Backup, Sync, Export }

/** Drawer selection survives rotation independently of a running or completed study session. */
enum class Destination(val label: String, val tool: LibraryTool? = null) {
    Study("Daily practice"), Reading("Reading passage"), Library("My vocabulary"),
    Add("Add an entry", LibraryTool.Add), Packs("Vocabulary packs", LibraryTool.Packs), Placement("Vocabulary starting check"),
    Backup("Backup & restore", LibraryTool.Backup), Sync("Cloud sync", LibraryTool.Sync), Export("Export to Anki", LibraryTool.Export), Sources("Content sources")
}

enum class SessionKind { Practice, Placement }

/** A running review always owns a card; a summary keeps only the kind of session that ended. */
sealed interface LearningScreen {
    data object Home : LearningScreen
    data object VocabularyPlacement : LearningScreen
    data class Review(val card: ReviewCard, val kind: SessionKind) : LearningScreen
    data class Summary(val kind: SessionKind) : LearningScreen
}
