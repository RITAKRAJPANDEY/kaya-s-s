# Kaya Knowledge Base

This directory contains construction safety documentation, Standard Operating Procedures (SOPs), equipment manuals, and site rules used by Kaya's Retrieval-Augmented Generation (RAG) layer.

## Directory Structure

```
knowledge/
├── README.md               # This documentation
├── manifest.json           # Local cache tracking uploaded documents and Gemini File Search store ID
└── documents/              # Place construction documents here (.pdf, .txt, .md, .docx)
    ├── site_safety_manual.txt
    ├── ladder_safety_sop.txt
    ├── ppe_compliance_policy.txt
    ├── scaffolding_safety_sop.txt
    └── heavy_equipment_sop.txt
```

## Adding Documents

1. Drop your construction PDFs, SOPs, manuals, or policies into the `documents/` folder.
2. Supported formats:
   - Portable Document Format (`.pdf`)
   - Plain Text (`.txt`)
   - Markdown (`.md`)
   - Microsoft Word (`.docx`)
3. Run the ingestion command:
   ```bash
   python scripts/ingest.py
   ```
4. The script uploads new/modified documents to Google Gemini File Search, verifies indexing status, and updates `manifest.json`.
5. Kaya will immediately ground its answers in the updated knowledge base.
