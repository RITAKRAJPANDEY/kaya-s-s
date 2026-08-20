"""RAG decision router for Kaya Assistant.

Determines whether a user question requires external/stored knowledge retrieval
(e.g., safety manuals, site rules, SOPs, compliance requirements) or can be
answered directly by the VLM.
"""

import logging
import re
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger("kaya.rag.router")


@dataclass
class RAGRoutingDecision:
    """Represents the output decision of the RAG router."""
    requires_rag: bool
    reason: str
    query: str


class RAGRouter:
    """Lightweight, deterministic RAG decision router."""

    # Explicit knowledge & compliance intent keywords and patterns
    KNOWLEDGE_PATTERNS = [
        # Explicit mentions of documentation
        r"\b(safety\s+manual|site\s+manual|operations?\s+manual|manual|equipment\s+manual)\b",
        r"\b(site\s+rules?|site\s+polic(y|ies)|company\s+polic(y|ies)|site\s+guidelines?)\b",
        r"\b(sop|sops|standard\s+operating\s+procedure|standard\s+operating\s+procedures)\b",
        r"\b(document(s|ation)?|protocol(s)?|directive(s)?|regulation(s)?|osha|ansi|astm)\b",
        
        # Compliance & Rule inquiries
        r"\b(compliant|compliance|non-compliant|violation|violating|authorized|permitted|allowed)\b",
        r"\b(require(d|ment|ments)?|standard(s)?|mandatory|rule(s)?|polic(y|ies))\b",
        r"\b(according\s+to\s+(the|our|site|safety)?\s*(manual|rules?|policy|sop|docs?|documents?|guidelines?))\b",
        r"\b(is\s+this\s+(safe|allowed|compliant|permitted|legal|acceptable))\b",
        r"\b(are\s+(these|we|they|workers?)\s+(safe|allowed|compliant|permitted|acceptable))\b",
        
        # Procedural / Specification inquiries
        r"\b(what\s+(is|are)\s+the\s+(procedure|steps|requirements?|standards?|rules?|limits?|clearance|distance|rating|duty))\b",
        r"\b(what\s+does\s+(the|our)\s+(manual|policy|rule|sop|document|documentation)\s+say)\b",
        r"\b(what\s+should\s+i\s+do\s+(according\s+to|here|if|when))\b",
        r"\b(minimum|maximum)\s+(height|depth|distance|clearance|weight|capacity|rating|overlap|slope)\b",
        r"\b(tie-off|fall\s+protection|harness|guardrail|toeboard|trench\s+box|shoring|scaffold|ladder)\s+(rules?|requirements?|standards?|policy|sop)\b",
    ]

    # Patterns indicating pure visual observation with no policy/document inquiry
    PURE_VISUAL_PATTERNS = [
        r"^(what\s+color\s+(is|are))\b",
        r"^(what\s+is\s+that(\s+object)?)$",
        r"^(what\s+am\s+i\s+looking\s+at)\??$",
        r"^(describe\s+(the|this)\s+(scene|image|view|camera))\b",
        r"^(how\s+many\s+(people|workers|objects|items|helmets|trucks|ladders)\s+are\s+there)\b",
        r"^(is\s+(the|that)\s+light\s+(on|off))\b",
        r"^(read\s+(the\s+)?(text|sign|label))\b",
    ]

    def __init__(self, mode: str = "auto"):
        """Initialize router.

        Args:
            mode: 'auto' (intelligent keyword/heuristic routing),
                  'always' (force RAG for all queries),
                  'never' (disable RAG for all queries).
        """
        self.mode = mode.lower()
        self._compiled_knowledge_patterns = [re.compile(p, re.IGNORECASE) for p in self.KNOWLEDGE_PATTERNS]
        self._compiled_visual_patterns = [re.compile(p, re.IGNORECASE) for p in self.PURE_VISUAL_PATTERNS]

    def route(self, question: str) -> RAGRoutingDecision:
        """Evaluate question and return routing decision.

        Args:
            question: The transcribed or typed user question.

        Returns:
            RAGRoutingDecision with requires_rag, reason, and query.
        """
        clean_q = question.strip() if question else ""
        if not clean_q:
            return RAGRoutingDecision(
                requires_rag=False,
                reason="Empty query",
                query=clean_q
            )

        if self.mode == "always":
            return RAGRoutingDecision(
                requires_rag=True,
                reason="RAG forced by configuration (mode='always')",
                query=clean_q
            )

        if self.mode == "never":
            return RAGRoutingDecision(
                requires_rag=False,
                reason="RAG disabled by configuration (mode='never')",
                query=clean_q
            )

        # Mode == 'auto': Check fast negative patterns first
        for vp in self._compiled_visual_patterns:
            if vp.search(clean_q):
                # Ensure it doesn't also contain explicit policy phrases
                has_doc_override = any(kp.search(clean_q) for kp in self._compiled_knowledge_patterns)
                if not has_doc_override:
                    logger.debug(f"[RAG Router] Bypassing RAG for pure visual question: '{clean_q}'")
                    return RAGRoutingDecision(
                        requires_rag=False,
                        reason="Visual observation question without policy/document context",
                        query=clean_q
                    )

        # Check knowledge & compliance patterns
        for kp in self._compiled_knowledge_patterns:
            match = kp.search(clean_q)
            if match:
                matched_phrase = match.group(0)
                logger.info(f"[RAG Router] RAG triggered for '{clean_q}' (Matched: '{matched_phrase}')")
                return RAGRoutingDecision(
                    requires_rag=True,
                    reason=f"Question references site documentation, rules, or compliance criteria ('{matched_phrase}')",
                    query=clean_q
                )

        # Default fallback for unclassified questions: No RAG
        logger.debug(f"[RAG Router] No RAG needed for generic question: '{clean_q}'")
        return RAGRoutingDecision(
            requires_rag=False,
            reason="Standard visual conversational inquiry (no document reference detected)",
            query=clean_q
        )
