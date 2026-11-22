package com.randspy.langocard

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle

/** Shows both answers, emphasizing the characters that differ. */
@Composable
internal fun TypedAnswerFeedback(answer: TypedAnswer) {
    Text(answer.match.label, style = MaterialTheme.typography.titleMedium)
    val alternative = answer.match == AnswerMatch.Alternative
    listOf("You typed" to answer.typedParts, (if (alternative) "Accepted" else "Expected") to answer.expectedParts).forEach { (label, parts) ->
        Text(buildAnnotatedString {
            append("$label: ")
            parts.forEach { part ->
                if (part.marked) withStyle(SpanStyle(background = MaterialTheme.colorScheme.errorContainer,
                    fontWeight = FontWeight.Bold)) { append(part.text) }
                else append(part.text)
            }
        })
    }
    if (alternative) Text("This card practises: ${answer.target}", fontWeight = FontWeight.Bold)
}
