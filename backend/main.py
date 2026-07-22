import os
import uuid
import datetime
from typing import List, Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse

from pydantic import BaseModel, Field
import json
import re

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception as e:
    print(f"Dotenv notification: {e}")

from backend.models import (
    CandidateProfile,
    CandidateRecord,
    JobDescription,
    MatchAnalysis
)
from backend.extractor import extract_text_from_file
from backend.ai_parser import parse_resume_with_gemini
from backend.vector_store import VectorStore
from backend.matcher import CandidateMatcher

# Try importing google.genai SDK
try:
    from google import genai
    from google.genai import types
    GENAI_AVAILABLE = True
except ImportError:
    GENAI_AVAILABLE = False

app = FastAPI(
    title="AI Resume Parser & Candidate Matcher API",
    description="Extracts candidate profile data from resumes (PDF/DOCX) and ranks candidates against Job Descriptions with HR proposals.",
    version="1.0.0"
)


# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize vector store and candidate matcher
vector_store = VectorStore()
matcher = CandidateMatcher(vector_store)


# Upload directory (absolute path for applicant pool storage)
UPLOAD_DIR = r"C:\Users\User\Desktop\Project\DB_Hackathon_2016\uploads\resumes"
os.makedirs(UPLOAD_DIR, exist_ok=True)

def sync_uploads_directory(store: VectorStore):
    """Scan C:\\Users\\User\\Desktop\\Project\\DB_Hackathon_2016\\uploads\\resumes and index any new resume files into candidate applicant pool."""
    if not os.path.exists(UPLOAD_DIR):
        return

    existing = store.list_all_candidates()
    existing_files = {r.file_name for r in existing}

    for fname in os.listdir(UPLOAD_DIR):
        fpath = os.path.join(UPLOAD_DIR, fname)
        if os.path.isfile(fpath) and fname not in existing_files:
            try:
                with open(fpath, "rb") as f:
                    content = f.read()
                raw_text = extract_text_from_file(content, fname)
                if raw_text and raw_text.strip():
                    # Fast local extraction without invoking LLM API before HR action
                    from backend.ai_parser import fallback_parse_resume
                    profile = fallback_parse_resume(raw_text, fname)
                    cand_id = f"cand-{uuid.uuid4().hex[:8]}"

                    record = CandidateRecord(
                        id=cand_id,
                        profile=profile,
                        raw_text=raw_text,
                        file_name=fname,
                        created_at=datetime.datetime.now().isoformat()
                    )
                    store.add_candidate(record)
                    # Auto submit application for active jobs
                    for job in JOBS_DATABASE:
                        APPLICATIONS_DATABASE.append(
                            JobApplication(
                                id=f"app-{uuid.uuid4().hex[:6]}",
                                job_id=job.id,
                                candidate_id=cand_id,
                                candidate_name=profile.full_name,
                                applied_at=datetime.datetime.now().isoformat(),
                                status="Applied",
                                candidate_availability=profile.availability,
                                candidate_nationality=profile.nationality
                            )
                        )
            except Exception as err:
                print(f"Upload sync error for {fname}: {err}")

# Job Descriptions database (populated exclusively when HR posts new jobs)
SAMPLE_JOBS: List[JobDescription] = []
JOBS_DATABASE: List[JobDescription] = []


# Dynamic in-memory Job Applications database
from backend.models import JobApplication

APPLICATIONS_DATABASE: List[JobApplication] = []


# Perform initial sync of uploads directory
try:
    sync_uploads_directory(vector_store)
except Exception as e:
    print(f"Initial upload sync notification: {e}")



class ApiKeyRequest(BaseModel):
    api_key: str

class JobParseRequest(BaseModel):
    raw_text: str

class ApplicationRequest(BaseModel):
    job_id: str
    candidate_id: str
    candidate_availability: Optional[str] = "Immediate"
    candidate_nationality: Optional[str] = "Any / Citizen"

class BatchProcessRequest(BaseModel):
    dataset_path: Optional[str] = r"C:\Users\User\Desktop\Project\DB_Hackathon_2016\resumes\data\data"
    category: Optional[str] = "INFORMATION-TECHNOLOGY"
    max_resumes: int = 15

class ApplicationStatusUpdate(BaseModel):
    status: str  # "Applied", "Shortlisted for Interview", "Selected", "Rejected"


@app.get("/api/api-key-status")
def get_api_key_status():
    """Check if Google AI API Key is active."""
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    has_key = bool(key and key.strip())
    masked_key = f"{key[:6]}...{key[-4:]}" if has_key and len(key) > 10 else ("Configured" if has_key else "Not Set")
    return {
        "has_api_key": has_key,
        "masked_key": masked_key,
        "genai_sdk_available": GENAI_AVAILABLE
    }


@app.post("/api/set-api-key")
def set_api_key_endpoint(req: ApiKeyRequest):
    """Set or update Google AI Gemini API Key at runtime."""
    key = req.api_key.strip()
    if not key:
        raise HTTPException(status_code=400, detail="API key cannot be empty.")

    os.environ["GEMINI_API_KEY"] = key
    os.environ["GOOGLE_API_KEY"] = key
    return {
        "status": "success",
        "message": "Google AI API Key updated successfully!",
        "has_api_key": True
    }



def parse_job_description_with_ai(raw_text: str) -> JobDescription:
    """Parse unformatted raw job text into structured JobDescription model using Google free LLM models."""
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if api_key and GENAI_AVAILABLE:
        free_models = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-flash-latest"]
        client = genai.Client(api_key=api_key)
        prompt = f"""
You are an expert HR recruiter. Extract structured job position details from the following raw job text into JSON matching the schema.
Include estimated salary range (salary_min, salary_max), target_candidate_count for interview shortlist, skill_weights for each skill (10-100%), education_level, required_availability, and required_nationality.

Job Text:
\"\"\"
{raw_text[:6000]}
\"\"\"
"""
        for model_name in free_models:
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=JobDescription,
                        temperature=0.1,
                    ),
                )
                if response.text:
                    data = json.loads(response.text)
                    jd = JobDescription(**data)
                    jd.raw_text = raw_text
                    if not jd.id:
                        jd.id = f"job-custom-{uuid.uuid4().hex[:6]}"
                    return jd
            except Exception as e:
                err_str = str(e)
                if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                    break


    # Fallback parser logic

    lines = [l.strip() for l in raw_text.splitlines() if l.strip()]
    title = lines[0] if lines else "Custom HR Job Position"
    if len(title) > 60:
        title = "Custom HR Job Opening"

    common_skills = [
        "Python", "JavaScript", "TypeScript", "React", "Node.js", "Express", "FastAPI",
        "Django", "Flask", "SQL", "PostgreSQL", "MongoDB", "Docker", "Kubernetes",
        "AWS", "GCP", "Azure", "Git", "CI/CD", "REST API", "GraphQL", "Java", "C++",
        "HTML", "CSS", "Tailwind", "Machine Learning", "Deep Learning", "TensorFlow",
        "PyTorch", "Data Analysis", "Pandas", "NumPy", "Scikit-Learn", "Agile", "Scrum"
    ]
    found = [s for s in common_skills if re.search(r'\b' + re.escape(s.lower()) + r'\b', raw_text.lower())]

    years_match = re.search(r'(\d+)\+?\s*years?', raw_text, re.IGNORECASE)
    min_exp = float(years_match.group(1)) if years_match else 2.0

    req_skills = found[:5] if found else ["General Engineering"]
    weights = {s: 100.0 / len(req_skills) for s in req_skills}

    return JobDescription(
        id=f"job-custom-{uuid.uuid4().hex[:6]}",
        title=title,
        department="HR Provided",
        required_skills=req_skills,
        preferred_skills=found[5:8] if len(found) > 5 else [],
        skill_weights=weights,
        min_years_experience=min_exp,
        salary_min=100000.0,
        salary_max=140000.0,
        salary_currency="$",
        target_candidate_count=3,
        education_level="Bachelor's Degree",
        required_availability="Immediate",
        required_nationality="Any",
        description=raw_text[:1000],
        raw_text=raw_text
    )


@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "vector_store_active": vector_store.collection is not None,
        "total_candidates": len(vector_store.list_all_candidates()),
        "total_jobs": len(JOBS_DATABASE),
        "total_applications": len(APPLICATIONS_DATABASE)
    }


@app.post("/api/upload-resume", response_model=CandidateRecord)
async def upload_resume(file: UploadFile = File(...)):
    """Upload resume (PDF/DOCX/TXT), extract text, parse with LLM, and index candidate."""
    try:
        contents = await file.read()
        file_name = file.filename or "uploaded_resume.pdf"
        
        # 1. Extract raw text
        raw_text = extract_text_from_file(contents, file_name)
        if not raw_text.strip():
            raise HTTPException(status_code=400, detail="Could not extract readable text from uploaded file.")

        # Save copy locally into C:\Users\User\Desktop\Project\DB_Hackathon_2016\uploads\resumes
        save_path = os.path.join(UPLOAD_DIR, file_name)
        with open(save_path, "wb") as f:
            f.write(contents)

        # 2. Structured parsing via Gemini LLM / Rule-based parser
        profile: CandidateProfile = parse_resume_with_gemini(raw_text, file_name)

        # 3. Create Candidate Record
        candidate_id = f"cand-{uuid.uuid4().hex[:8]}"
        record = CandidateRecord(
            id=candidate_id,
            profile=profile,
            raw_text=raw_text,
            file_name=file_name,
            created_at=datetime.datetime.now().isoformat()
        )

        # 4. Save to Vector Store
        vector_store.add_candidate(record)

        return record

    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process resume: {str(e)}")


@app.post("/api/batch-process-resumes")
def batch_process_resumes(req: BatchProcessRequest):
    """Batch process PDF resumes from local dataset path C:\\Users\\User\\Desktop\\Project\\DB_Hackathon_2016\\resumes\\data\\data and store in uploads\\resumes."""
    base_dir = req.dataset_path or r"C:\Users\User\Desktop\Project\DB_Hackathon_2016\resumes\data\data"
    if not os.path.exists(base_dir):
        raise HTTPException(status_code=404, detail=f"Dataset path not found: {base_dir}")

    categories = [req.category] if req.category and req.category.upper() != "ALL" else os.listdir(base_dir)
    
    processed_records = []
    files_to_process = []

    for cat in categories:
        cat_dir = os.path.join(base_dir, cat)
        if os.path.isdir(cat_dir):
            for fname in os.listdir(cat_dir):
                if fname.lower().endswith(".pdf"):
                    files_to_process.append((cat, fname, os.path.join(cat_dir, fname)))
                    if len(files_to_process) >= req.max_resumes:
                        break
        if len(files_to_process) >= req.max_resumes:
            break

    if not files_to_process:
        return {"processed_count": 0, "message": "No PDF resume files found in dataset path.", "candidates": []}

    # Avoid duplicate processing by checking file_name
    existing_records = vector_store.list_all_candidates()
    existing_filenames = {r.file_name for r in existing_records}

    for cat, fname, fpath in files_to_process:
        file_identifier = f"{cat}_{fname}"
        if file_identifier in existing_filenames or fname in existing_filenames:
            continue

        try:
            with open(fpath, "rb") as f:
                content = f.read()
            
            # Save copy to C:\Users\User\Desktop\Project\DB_Hackathon_2016\uploads\resumes
            upload_target_path = os.path.join(UPLOAD_DIR, file_identifier)
            with open(upload_target_path, "wb") as f_out:
                f_out.write(content)

            raw_text = extract_text_from_file(content, fname)
            if not raw_text.strip():
                continue

            profile = parse_resume_with_gemini(raw_text, fname)
            if profile.full_name.startswith("Candidate "):
                profile.full_name = f"{profile.full_name} ({cat.replace('-', ' ')})"

            cand_id = f"cand-{uuid.uuid4().hex[:8]}"
            record = CandidateRecord(
                id=cand_id,
                profile=profile,
                raw_text=raw_text,
                file_name=file_identifier,
                created_at=datetime.datetime.now().isoformat()
            )
            vector_store.add_candidate(record)
            processed_records.append(record)


            # Auto-submit application for sample jobs if database has jobs
            for job in JOBS_DATABASE:
                APPLICATIONS_DATABASE.append(
                    JobApplication(
                        id=f"app-{uuid.uuid4().hex[:6]}",
                        job_id=job.id,
                        candidate_id=cand_id,
                        candidate_name=profile.full_name,
                        applied_at=datetime.datetime.now().isoformat(),
                        status="Applied",
                        candidate_availability=profile.availability,
                        candidate_nationality=profile.nationality
                    )
                )
        except Exception as err:
            print(f"Error batch processing {fname}: {err}")

    return {
        "processed_count": len(processed_records),
        "total_store_candidates": len(vector_store.list_all_candidates()),
        "processed_candidates": [{"id": r.id, "name": r.profile.full_name, "skills": r.profile.skills[:5]} for r in processed_records]
    }


@app.get("/api/candidates", response_model=List[CandidateRecord])
def get_all_candidates():
    """List all parsed candidates."""
    return vector_store.list_all_candidates()


@app.get("/api/candidates/{candidate_id}", response_model=CandidateRecord)
def get_candidate(candidate_id: str):
    """Retrieve specific candidate details."""
    record = vector_store.get_candidate(candidate_id)
    if not record:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return record


@app.get("/api/sample-jobs", response_model=List[JobDescription])
def get_sample_jobs():
    """Get all job descriptions (sample + HR provided custom jobs)."""
    return JOBS_DATABASE


@app.post("/api/jobs/parse", response_model=JobDescription)
def parse_job_description_endpoint(request: JobParseRequest):
    """Extract structured JobDescription fields from raw job text provided by HR."""
    if not request.raw_text or not request.raw_text.strip():
        raise HTTPException(status_code=400, detail="Raw job description text cannot be empty.")
    
    parsed_job = parse_job_description_with_ai(request.raw_text)
    return parsed_job


@app.post("/api/jobs", response_model=JobDescription)
def create_custom_job(job: JobDescription):
    """Allow HR to save/submit a custom job description into the portal."""
    if not job.id:
        job.id = f"job-custom-{uuid.uuid4().hex[:6]}"
    
    # Avoid duplicate ID
    existing_ids = [j.id for j in JOBS_DATABASE]
    if job.id not in existing_ids:
        JOBS_DATABASE.append(job)
    else:
        # Update existing
        idx = existing_ids.index(job.id)
        JOBS_DATABASE[idx] = job

    return job


@app.post("/api/applications", response_model=JobApplication)
def submit_job_application(req: ApplicationRequest):
    """Job seeker submits application for a specific job."""
    candidate = vector_store.get_candidate(req.candidate_id)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate profile not found. Please upload resume first.")

    job = next((j for j in JOBS_DATABASE if j.id == req.job_id), None)
    if not job:
        raise HTTPException(status_code=404, detail="Job position not found.")

    if req.candidate_availability:
        candidate.profile.availability = req.candidate_availability
    if req.candidate_nationality:
        candidate.profile.nationality = req.candidate_nationality

    existing = next((a for a in APPLICATIONS_DATABASE if a.job_id == req.job_id and a.candidate_id == req.candidate_id), None)
    if existing:
        return existing

    app_id = f"app-{uuid.uuid4().hex[:6]}"
    new_app = JobApplication(
        id=app_id,
        job_id=req.job_id,
        candidate_id=req.candidate_id,
        candidate_name=candidate.profile.full_name,
        applied_at=datetime.datetime.now().isoformat(),
        status="Applied",
        candidate_availability=candidate.profile.availability,
        candidate_nationality=candidate.profile.nationality
    )
    APPLICATIONS_DATABASE.append(new_app)
    return new_app


@app.post("/api/applications/{app_id}/status")
def update_application_status(app_id: str, payload: ApplicationStatusUpdate):
    """Update selection status of job application for HR final selection."""
    app_record = next((a for a in APPLICATIONS_DATABASE if a.id == app_id), None)
    if not app_record:
        # Check if app_id matches candidate_id
        app_record = next((a for a in APPLICATIONS_DATABASE if a.candidate_id == app_id), None)
    
    if not app_record:
        raise HTTPException(status_code=404, detail="Application record not found")

    app_record.status = payload.status
    return app_record


@app.get("/api/applications", response_model=List[JobApplication])
def get_applications(job_id: Optional[str] = None, candidate_id: Optional[str] = None):
    """List job applications filtered by job_id or candidate_id."""
    results = list(APPLICATIONS_DATABASE)
    if job_id:
        results = [a for a in results if a.job_id == job_id]
    if candidate_id:
        results = [a for a in results if a.candidate_id == candidate_id]
    return results


@app.get("/api/jobs/{job_id}/ranked-applicants", response_model=List[MatchAnalysis])
def get_ranked_applicants(job_id: str):
    """Rank all candidates who submitted applications for job_id and suggest top X candidates."""
    job = next((j for j in JOBS_DATABASE if j.id == job_id), None)
    if not job:
        raise HTTPException(status_code=404, detail="Job position not found")

    apps = [a for a in APPLICATIONS_DATABASE if a.job_id == job_id]
    if not apps:
        return []

    app_status_map = {a.candidate_id: a.status for a in apps}

    candidate_records = []
    for a in apps:
        rec = vector_store.get_candidate(a.candidate_id)
        if rec:
            candidate_records.append(rec)

    if not candidate_records:
        return []

    ranked = matcher.match_candidates_for_job(job_description=job, candidate_records=candidate_records)
    for r in ranked:
        if r.candidate_id in app_status_map:
            r.selection_status = app_status_map[r.candidate_id]
    return ranked


@app.post("/api/match", response_model=List[MatchAnalysis])
def match_candidates(job: JobDescription, top_k: int = 50):
    """Match stored candidates against a Job Description and rank them with HR proposals."""
    if not vector_store.list_all_candidates():
        return []
    
    match_results = matcher.match_candidates_for_job(job, top_k=top_k)
    return match_results


# Mount static files directory if present
if os.path.exists("./static"):
    app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/", response_class=HTMLResponse)
def read_root():
    """Serve web dashboard HTML."""
    if os.path.exists("./static/index.html"):
        with open("./static/index.html", "r", encoding="utf-8") as f:
            return f.read()
    return "<h1>AI Resume Parser & Candidate Matcher API Running</h1><p>Visit <a href='/docs'>/docs</a> for API Swagger documentation.</p>"


