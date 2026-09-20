import os
import json
import time
from pathlib import Path
from functools import lru_cache
from openai import OpenAI, APIStatusError
import re

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from pypdf import PdfReader

# 1. Load .env FIRST
load_dotenv()

# 2. Read the key
my_api_key = os.getenv("SENSE_NOVA_API_KEY")
if not my_api_key:
    raise ValueError("SENSE_NOVA_API_KEY not found in .env")

# 3. Create the client
client = OpenAI(
    base_url="https://token.sensenova.ai/v1",
    api_key=my_api_key,
)

# 4. Pick your model
model = "sensenova-6.8-flash-lite"

# 5. Create the app
app = FastAPI()

BASE_DIR = Path(__file__).resolve().parent.parent   # portfolioai/
app.mount("/static", StaticFiles(directory=BASE_DIR / "frontend"), name="static")


# ---------------- Pydantic models ----------------
class Experience(BaseModel):
    company: str | None = None
    role: str | None = None
    duration: str | None = None
    description: str | None = None
    skills_used: list[str] = []

class Resume(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    total_experience_years: float | None = None
    skills: list[str] = []
    experiences: list[Experience] = []
    education: list[str] = []
    projects: list[str] = []
    certifications: list[str] = []

resume_schema = Resume.model_json_schema()


class ChatRequest(BaseModel):
    question: str


# ---------------- Resume parsing ----------------
def read_pdf(file_path: Path) -> str:
    reader = PdfReader(file_path)
    text = ""
    for page in reader.pages:
        page_text = page.extract_text()
        if page_text:
            text += page_text + "\n"
    return text

import re

def extract_json(text: str) -> str:
    """Pull the first {...} JSON object out of a string."""
    if not text:
        raise ValueError("Model returned empty content")
    text = text.strip()
    # Strip markdown code fences
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    # Grab from the first { to the last }
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError(f"No JSON object found in: {text[:200]}")
    return text[start:end + 1]

def parse_resume(resume_text: str) -> Resume:
    system_prompt = f"""
    You are an expert resume parser.

    Extract information from the resume based on its meaning,
    not only based on exact section headings.

    Return ONLY valid JSON matching this schema:

    {resume_schema}

    Important rules:
    1. Do not invent information.
    2. If a value is not available, return null.
    3. If a list has no information, return an empty list.
    4. Include internships inside experiences.
    5. Extract skills mentioned across the entire resume.
    """
    user_prompt = f"Parse the following resume:\n\n{resume_text}"

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    response = client.chat.completions.create(
        model=model,
        messages=messages,
        response_format={"type": "json_object"},
    )
    raw_output = response.choices[0].message.content
    data = json.loads(raw_output)
    return Resume(**data)


@lru_cache(maxsize=1)
def get_resume() -> Resume:
    """Parse the resume once and cache it."""
    pdf_path = BASE_DIR / "backend" / "sanjeet_resume.pdf"   # adjust if needed
    resume_text = read_pdf(pdf_path)
    return parse_resume(resume_text)


# ---------------- Candidate Q&A ----------------
def _candidate_system_prompt(resume: Resume) -> str:
    return f"""
You are an AI assistant representing a job candidate.

Below is everything you know about the candidate.

{resume.model_dump_json(indent=2)}

Rules:
1. Answer only using this information.
2. Never hallucinate.
3. If information is unavailable, say "I don't have enough information to answer that."
4. Be professional.
5. Answer as if HR is interviewing this candidate.
"""


def ask_candidate(question: str, resume: Resume) -> str:
    """Non-streaming version — used by /chat."""
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": _candidate_system_prompt(resume)},
            {"role": "user", "content": question},
        ],
    )
    return response.choices[0].message.content


def ask_candidate_stream(question: str, resume: Resume):
    """Streaming version — used by /chat/stream."""
    stream = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": _candidate_system_prompt(resume)},
            {"role": "user", "content": question},
        ],
        stream=True,
    )
    for chunk in stream:
        # Guard: some providers send metadata-only chunks with empty choices
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        if delta and delta.content:
            yield delta.content


# ---------------- Routes ----------------
@app.get("/")
def home():
    return FileResponse(BASE_DIR / "frontend" / "index.html")


@app.post("/chat")
def chat(request: ChatRequest):
    resume = get_resume()
    answer = ask_candidate(request.question, resume)
    return {"answer": answer}


@app.post("/chat/stream")
def chat_stream(request: ChatRequest):
    resume = get_resume()
    return StreamingResponse(
        ask_candidate_stream(request.question, resume),
        media_type="text/plain; charset=utf-8",
    )