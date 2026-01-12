# Playwright + Claude Enrichment Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Firecrawl with Playwright text extraction + Claude summarization for company enrichment.

**Why:** Firecrawl is too expensive, less control, reliability issues. New approach is 10-50x cheaper.

---

## Architecture

1. Playwright visits company URL (already happening for screenshots)
2. Extract visible text from DOM - title, headings, paragraphs, meta description
3. Send to Claude: "Summarize what this company does in 2-3 sentences"
4. Store summary in `company_description` field

One browser visit, two outputs (screenshot + text).

---

## Text Extraction

**What to extract:**
- `<title>`
- `<meta name="description">` and `<meta property="og:description">`
- `<h1>`, `<h2>` headings
- `<p>` paragraphs (first ~10)

**Cleanup:**
- Strip nav, footer, cookie banners
- Limit to ~2000 characters for Claude
- Handle empty pages gracefully

**Claude prompt:**
```
Based on this website content, write 2-3 sentences describing what this company does. Be specific about their product/service. If unclear, say so.

Content:
{extracted_text}
```

---

## Files to Modify

1. **`screenshot_service.py`** → rename to `enrichment_service.py`
   - Add `extract_page_text()` alongside screenshot capture
   - Return both screenshot path AND extracted text

2. **`job_processor.py`**
   - Replace `FirecrawlClient` with new enrichment service
   - Add Claude API call for summarization

3. **`requirements.txt`**
   - Remove `firecrawl-py`

4. **Database** - no schema changes, just populate fewer fields

---

## Error Handling

- **Page timeout:** 15 seconds, mark failed, keep any screenshot
- **Empty content (<50 chars):** Skip Claude, set description to "Could not extract"
- **Claude failure:** Store raw extracted text, log error
- **Bot protection:** Mark failed, move on (same as screenshot failures)

---

## Success Criteria

1. CSV upload enriches companies with screenshot + AI summary
2. ~$0.001 per page (vs $0.01-0.05 with Firecrawl)
3. One browser visit for both outputs
4. Firecrawl dependency removed
