# EmotionLens Gemini Chat

A polished Python Flask app that integrates Google Gemini, remembers conversation history, and optionally uses Google Custom Search for real-time questions like current Bitcoin prices or weather in Mumbai.

## Features

- Google Gemini chat
- Session-based conversation memory
- Real-time search grounding with Google Custom Search API
- Modern responsive UI
- Sources panel for search results

## Tech Stack

- Python
- Flask
- Google Generative AI API (`google-generativeai`)
- Google Custom Search API
- HTML, CSS, and vanilla JavaScript

## Folder Structure

```text
Gemini AI/
├── app.py
├── requirements.txt
├── .env.example
├── README.md
├── templates/
│   └── index.html
└── static/
    ├── css/
    │   └── style.css
    └── js/
        └── app.js
```

## Setup

1. Open PowerShell in the `Gemini AI` folder.

2. Create and activate a virtual environment:

```powershell
python -m venv .venv
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned
.\.venv\Scripts\Activate.ps1
```

3. Install dependencies:

```powershell
pip install -r requirements.txt
```

4. Create a `.env` file from `.env.example` and add your keys:

- `GEMINI_API_KEY`
- `GOOGLE_SEARCH_API_KEY`
- `GOOGLE_SEARCH_CX`
- `FLASK_SECRET_KEY`

## Run

```powershell
python app.py
```

Then open:

```text
http://127.0.0.1:5000
```

## Notes on Real-Time Search

This app uses Google Custom Search API for current information. To enable it:

1. Create a Programmable Search Engine.
2. Enable the Custom Search JSON API in Google Cloud.
3. Set `GOOGLE_SEARCH_API_KEY` and `GOOGLE_SEARCH_CX` in `.env`.

If those keys are missing, the assistant still works, but it will answer from Gemini without web search context.

## Conversation Memory

The app stores conversation history in server memory per browser session. The model receives recent history on every request so it can refer to earlier user messages and assistant replies.

## If you need the React component version

The `v0-ai-chat.tsx` component you shared is a React/TypeScript component and is not directly usable in a Python Flask app. If you want that exact UI, the correct path is a Next.js + shadcn UI project with Tailwind CSS and TypeScript.

## License

Add an MIT or other license if you plan to publish this repository.
