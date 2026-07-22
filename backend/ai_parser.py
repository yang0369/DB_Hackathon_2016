import os
import json
import re
from typing import Optional
from backend.models import CandidateProfile, ExperienceItem, EducationItem

# Try importing google.genai SDK
try:
    from google import genai
    from google.genai import types
    GENAI_AVAILABLE = True
except ImportError:
    GENAI_AVAILABLE = False


def fallback_parse_resume(raw_text: str, filename: str) -> CandidateProfile:
    """Heuristic rule-based fallback parser when LLM API is unavailable or unconfigured."""
    lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
    
    # Try guessing name from top lines or filename
    full_name = "Candidate " + os.path.splitext(filename)[0].replace("_", " ").replace("-", " ").title()
    if lines:
        for l in lines[:5]:
            if len(l) < 40 and not any(char.isdigit() for char in l) and "@" not in l:
                full_name = l.title()
                break

    # Extract email
    email = None
    email_match = re.search(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', raw_text)
    if email_match:
        email = email_match.group(0)

    # Extract phone
    phone = None
    phone_match = re.search(r'(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}', raw_text)
    if phone_match:
        phone = phone_match.group(0)

    # Extract common tech skills via regex scanning
    common_skills = [
        "Python", "JavaScript", "TypeScript", "React", "Node.js", "Express", "FastAPI",
        "Django", "Flask", "SQL", "PostgreSQL", "MongoDB", "Docker", "Kubernetes",
        "AWS", "GCP", "Azure", "Git", "CI/CD", "REST API", "GraphQL", "Java", "C++",
        "HTML", "CSS", "Tailwind", "Machine Learning", "Deep Learning", "TensorFlow",
        "PyTorch", "Data Analysis", "Pandas", "NumPy", "Scikit-Learn", "Agile", "Scrum"
    ]
    extracted_skills = []
    text_lower = raw_text.lower()
    for skill in common_skills:
        if re.search(r'\b' + re.escape(skill.lower()) + r'\b', text_lower):
            extracted_skills.append(skill)

    # Estimate experience years
    years_match = re.findall(r'(\d+)\+?\s*years?', text_lower)
    est_years = 0.0
    if years_match:
        est_years = max([float(y) for y in years_match if float(y) < 40], default=2.0)
    else:
        est_years = 3.0 if len(raw_text) > 1000 else 1.0

    # Extract availability if present
    availability = "Immediate"
    if "2 week" in text_lower or "two week" in text_lower or "14 day" in text_lower:
        availability = "2 Weeks Notice"
    elif "1 month" in text_lower or "one month" in text_lower or "30 day" in text_lower:
        availability = "1 Month Notice"
    elif "immediate" in text_lower or "available now" in text_lower:
        availability = "Immediate"

    # Extract nationality / location if present
    nationality = "Any / Citizen"
    if "singapore" in text_lower or "citizen" in text_lower or "pr" in text_lower:
        nationality = "Singapore Citizen / PR"
    elif "us citizen" in text_lower or "green card" in text_lower or "united states" in text_lower:
        nationality = "US Citizen / Green Card"

    return CandidateProfile(
        full_name=full_name,
        email=email,
        phone=phone,
        location=None,
        summary=raw_text[:300] + "..." if len(raw_text) > 300 else raw_text,
        skills=extracted_skills if extracted_skills else ["General Engineering"],
        experience=[
            ExperienceItem(
                title="Software Professional",
                company="Previous Employer",
                duration="Recent",
                description=raw_text[:200]
            )
        ],
        education=[
            EducationItem(
                degree="Bachelor's Degree",
                institution="University",
                year="N/A"
            )
        ],
        certifications=[],
        years_of_experience=est_years,
        availability=availability,
        nationality=nationality
    )


def parse_resume_with_gemini(raw_text: str, filename: str) -> CandidateProfile:
    """Parse raw resume text into structured CandidateProfile using Google free LLM models (gemini-1.5-flash)."""
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    
    if not api_key or not GENAI_AVAILABLE:
        print("Using rule-based fallback parser (GEMINI_API_KEY not provided or google-genai package missing)")
        return fallback_parse_resume(raw_text, filename)

    # Google AI Free Tier Models
    free_models = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-flash-latest"]

    client = genai.Client(api_key=api_key)
    prompt = f"""
You are an expert resume parser. Extract structured information from the following resume text into JSON matching the specified schema.
Include candidate's full name, email, phone, location, skills, experience, education, total years of experience, availability (e.g. Immediate, 2 Weeks Notice, 1 Month Notice), and nationality or work authorization status.

Resume Text:
\"\"\"
{raw_text[:8000]}
\"\"\"
"""
    for model_name in free_models:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=CandidateProfile,
                    temperature=0.1,
                ),
            )

            if response.text:
                data = json.loads(response.text)
                profile = CandidateProfile(**data)
                if not profile.availability:
                    profile.availability = "Immediate"
                if not profile.nationality:
                    profile.nationality = "Any / Citizen"
                return profile
        except Exception as e:
            err_str = str(e)
            if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                break
    
    return fallback_parse_resume(raw_text, filename)



