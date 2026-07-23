import os
import uuid
import datetime
from typing import List, Optional, Dict
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
    JDKeyRequirements,
    MatchAnalysis,
    InterviewQuestion,
    InterviewTurn,
    VoiceAssessment,
    CheatingReport,
    InterviewSession,
    UserAccount,
    InterviewInvitation,
    PhysicalInterviewSchedule
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
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uploads", "candidate_pool")
os.makedirs(UPLOAD_DIR, exist_ok=True)

def sync_uploads_directory(store: VectorStore):
    """Scan uploads/candidate_pool and index any new resume files into candidate applicant pool.
    Also purges vector store & candidate records for files that were deleted from candidate_pool.
    """
    if not os.path.exists(UPLOAD_DIR):
        return

    current_files = {fname for fname in os.listdir(UPLOAD_DIR) if os.path.isfile(os.path.join(UPLOAD_DIR, fname))}

    # Reconcile vector store & memory DB against current files on disk
    store.reconcile_with_files(current_files)

    existing = store.list_all_candidates()
    existing_files = {r.file_name for r in existing}

    for fname in current_files:
        fpath = os.path.join(UPLOAD_DIR, fname)
        if fname not in existing_files:
            try:
                with open(fpath, "rb") as f:
                    content = f.read()
                raw_text = extract_text_from_file(content, fname)
                if raw_text and raw_text.strip():
                    from backend.ai_parser import parse_resume_with_gemini
                    profile = parse_resume_with_gemini(raw_text, fname)
                    cand_id = f"cand-{uuid.uuid4().hex[:8]}"

                    record = CandidateRecord(
                        id=cand_id,
                        profile=profile,
                        raw_text=raw_text,
                        file_name=fname,
                        created_at=datetime.datetime.now().isoformat()
                    )
                    store.add_candidate(record)
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
    return {
        "has_api_key": has_key,
        "status": "Active" if has_key else "Not Set",
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
    """Parse unformatted raw job text into structured JobDescription model using Google free LLM models with persistent caching.
    
    Two-pass strategy:
    1. Extract structured key requirements (skills, experience, qualifications, education) as JDKeyRequirements
    2. Extract full JobDescription with all scoring fields
    """
    # 1. Check persistent cache
    try:
        from backend.cache import cache_manager
        cached_jd = cache_manager.get_cached_jd(raw_text)
        if cached_jd:
            print("⚡ Cache hit for Job Description extraction")
            return cached_jd
    except Exception as e:
        print(f"JD cache lookup notice: {e}")

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if api_key and GENAI_AVAILABLE:
        free_models = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-flash-latest"]
        client = genai.Client(api_key=api_key)

        # --- Pass 1: Extract structured key requirements for HR criteria preview ---
        jd_key_req: Optional[JDKeyRequirements] = None
        key_req_prompt = f"""
You are an expert HR recruiter analyzing a job description.
Extract structured hiring criteria from the following job text. Categorize requirements clearly into mandatory vs preferred, and extract hard criteria (knockout rules).

IMPORTANT: Actively look for and extract cutting-edge and domain-specific skills, such as "Large Language Models", "Generative AI", "Text-to-Speech", "Prompt Engineering", "Machine Learning", and specific industry domain knowledge if present. Do not limit extraction to just generic software engineering skills.

Return a JSON object matching this schema:
- key_skills: list of must-have technical/functional skills (top 8 max, including specific AI/ML technologies if mentioned)
- preferred_skills: list of nice-to-have skills (top 5 max)
- key_experience: list of key experience bullet points required (top 5 max, short phrases)
- key_qualifications: list of key qualifications/certifications required (top 5 max)
- academic_qualifications: list of academic background/degree/major requirements (e.g. "Bachelor in CS/IT/STEM", "Master's Degree in Data Science")
- required_certifications: list of professional certifications required or preferred (e.g. "PMP", "AWS Certified", "CPA")
- education_level: minimum education level required (e.g. "Bachelor's Degree", "Master's Degree", "Diploma")
- min_years_experience: minimum years of professional experience as a number (float)
- skill_weights: dict mapping each key skill to an importance weight (10-100, where 100 = most critical)
- hard_criteria: object with non-negotiable knockout rules:
    * mandatory_nationality: specific required citizenship/work status if mandated (e.g. "Singapore Citizen/PR", "US Citizen/Green Card", or "Any")
    * strict_degree_required: boolean true if academic degree is strict non-negotiable
    * strict_min_years: minimum required experience as float
    * hard_skills: list of mandatory non-negotiable skills

Job Description:
\"\"\"
{raw_text[:5000]}
\"\"\"
"""
        for model_name in free_models:
            try:
                kr_response = client.models.generate_content(
                    model=model_name,
                    contents=key_req_prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=JDKeyRequirements,
                        temperature=0.1,
                    ),
                )
                if kr_response.text:
                    kr_data = json.loads(kr_response.text)
                    jd_key_req = JDKeyRequirements(**kr_data)
                    break
            except Exception as e:
                err_str = str(e)
                if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                    break

        # --- Pass 2: Extract full JobDescription ---
        jd_prompt = f"""
You are an expert HR recruiter. Extract structured job position details from the following raw job text into JSON matching the schema.
Include estimated salary range (salary_min, salary_max), target_candidate_count for interview shortlist,
skill_weights for each skill (10-100%), education_level, academic_qualifications, required_certifications, required_availability, and required_nationality.

CRITICAL: Extract specific advanced technology and AI domain skills (e.g., Large Language Models, Generative AI, Text-to-Speech) into the required_skills and preferred_skills lists if they are mentioned.

For required_availability use one of: Immediate, 2 Weeks Notice, 1 Month Notice, Any.
For required_nationality use one of: Singapore Citizen/PR, US Citizen/Green Card, Employment Pass, Any.
If the job explicitly states "Singaporeans/PR only" or similar, set required_nationality="Singapore Citizen/PR" and specify hard_criteria.mandatory_nationality="Singapore Citizen/PR".

Job Text:
\"\"\"
{raw_text[:6000]}
\"\"\"
"""
        for model_name in free_models:
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=jd_prompt,
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
                    # Attach key requirements preview
                    if jd_key_req:
                        jd.jd_key_requirements = jd_key_req
                        if jd_key_req.key_skills and not jd.required_skills:
                            jd.required_skills = jd_key_req.key_skills
                        if jd_key_req.preferred_skills and not jd.preferred_skills:
                            jd.preferred_skills = jd_key_req.preferred_skills
                        if jd_key_req.skill_weights and not jd.skill_weights:
                            jd.skill_weights = jd_key_req.skill_weights
                        if jd_key_req.min_years_experience and not jd.min_years_experience:
                            jd.min_years_experience = jd_key_req.min_years_experience
                        if jd_key_req.education_level and not jd.education_level:
                            jd.education_level = jd_key_req.education_level
                        if jd_key_req.academic_qualifications and not jd.academic_qualifications:
                            jd.academic_qualifications = jd_key_req.academic_qualifications
                        if jd_key_req.required_certifications and not jd.required_certifications:
                            jd.required_certifications = jd_key_req.required_certifications
                        if jd_key_req.hard_criteria and not jd.hard_criteria:
                            jd.hard_criteria = jd_key_req.hard_criteria
                    
                    # Store in cache
                    try:
                        from backend.cache import cache_manager
                        cache_manager.set_cached_jd(raw_text, jd)
                    except Exception as e:
                        print(f"Failed to save JD to cache: {e}")
                    
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

    fallback_key_req = JDKeyRequirements(
        key_skills=req_skills,
        preferred_skills=found[5:8] if len(found) > 5 else [],
        key_experience=[f"Minimum {min_exp:.0f} years of relevant professional experience"],
        key_qualifications=[],
        academic_qualifications=["Bachelor's Degree in Computer Science or related STEM field"],
        education_level="Bachelor's Degree",
        min_years_experience=min_exp,
        skill_weights=weights
    )

    fallback_jd = JobDescription(
        id=f"job-custom-{uuid.uuid4().hex[:6]}",
        title=title,
        department="Engineering",
        required_skills=req_skills,
        preferred_skills=found[5:8] if len(found) > 5 else [],
        skill_weights=weights,
        min_years_experience=min_exp,
        salary_min=100000,
        salary_max=150000,
        target_candidate_count=3,
        education_level="Bachelor's Degree",
        academic_qualifications=["Bachelor's Degree in Computer Science or related STEM field"],
        description=raw_text[:1000],
        raw_text=raw_text,
        jd_key_requirements=fallback_key_req
    )
    
    try:
        from backend.cache import cache_manager
        cache_manager.set_cached_jd(raw_text, fallback_jd)
    except Exception:
        pass

    return fallback_jd


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

        # Save copy locally into uploads/candidate_pool
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
    r"""Batch process PDF resumes from local dataset path C:\Users\User\Desktop\Project\DB_Hackathon_2016\resumes\data\data and store in uploads\candidate_pool."""
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
            
            # Save copy to uploads/candidate_pool
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
    """Sync candidates directory and list all active candidates."""
    sync_uploads_directory(vector_store)
    return vector_store.list_all_candidates()


@app.post("/api/candidates/sync")
def sync_candidates_endpoint():
    """Reconcile and sync candidate pool files on disk with vector store and memory database."""
    sync_uploads_directory(vector_store)
    return {
        "status": "success",
        "total_candidates": len(vector_store.list_all_candidates()),
        "candidates": [{"id": r.id, "name": r.profile.full_name, "file": r.file_name} for r in vector_store.list_all_candidates()]
    }


@app.get("/api/cache/stats")
def get_cache_stats():
    """Get persistent LLM cache statistics."""
    from backend.cache import cache_manager
    return cache_manager.get_stats()


@app.post("/api/cache/clear")
def clear_cache_endpoint():
    """Clear all persistent LLM cache entries."""
    from backend.cache import cache_manager
    cache_manager.clear_all()
    return {
        "status": "success",
        "message": "Persistent LLM cache cleared successfully."
    }


@app.post("/api/candidates/clear-all")
def clear_all_candidates_endpoint():
    """Purge all vector embeddings, candidate records, and applications."""
    vector_store.reset_all()
    from backend.cache import cache_manager
    cache_manager.clear_all()
    global APPLICATIONS_DATABASE
    APPLICATIONS_DATABASE.clear()
    return {
        "status": "success",
        "message": "All candidate vector embeddings, candidate records, and LLM cache purged successfully."
    }


@app.get("/api/candidates/{candidate_id}", response_model=CandidateRecord)
def get_candidate(candidate_id: str):
    """Retrieve specific candidate details."""
    sync_uploads_directory(vector_store)
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
    sync_uploads_directory(vector_store)
    if not vector_store.list_all_candidates():
        return []
    
    match_results = matcher.match_candidates_for_job(job, top_k=top_k)
    return match_results


@app.get("/api/jobs/{job_id}/rank-all-candidates", response_model=List[MatchAnalysis])
def rank_all_candidates_for_job(job_id: str):
    """Rank ALL candidates in the pool against job_id requirements (not limited to applicants)."""
    sync_uploads_directory(vector_store)
    job = next((j for j in JOBS_DATABASE if j.id == job_id), None)
    if not job:
        raise HTTPException(status_code=404, detail="Job position not found")

    all_candidates = vector_store.list_all_candidates()
    if not all_candidates:
        return []

    # Build application status map to enrich results where candidates did apply
    app_status_map = {a.candidate_id: a.status for a in APPLICATIONS_DATABASE if a.job_id == job_id}

    ranked = matcher.match_candidates_for_job(job_description=job, candidate_records=all_candidates)

    for r in ranked:
        # Mark applied candidates with their actual status; others show as "In Pool"
        if r.candidate_id in app_status_map:
            r.selection_status = app_status_map[r.candidate_id]
        else:
            r.selection_status = "In Pool"

    return ranked


# Directory for candidate interview video recordings
INTERVIEW_VIDEOS_DIR = os.path.join(UPLOAD_DIR, "interview_videos")
os.makedirs(INTERVIEW_VIDEOS_DIR, exist_ok=True)

# In-memory storage for active and completed interview sessions
INTERVIEW_SESSIONS_DATABASE: Dict[str, InterviewSession] = {}


class InterviewStartRequest(BaseModel):
    candidate_id: str
    job_id: str

class InterviewTurnRequest(BaseModel):
    session_id: str
    candidate_speech_text: str
    stage: Optional[str] = "interview"
    current_question_index: int = 0
    tab_switch_count: int = 0
    suspicious_silence_count: int = 0

class InterviewEvaluateRequest(BaseModel):
    session_id: str
    tab_switches: int = 0
    suspicious_silences: int = 0
    gaze_anomalies: int = 0


@app.post("/api/interview/start", response_model=InterviewSession)
def start_interview_session(req: InterviewStartRequest):
    """Start an AI Voice Interview session for a candidate and job position."""
    candidate = vector_store.get_candidate(req.candidate_id)
    job = next((j for j in JOBS_DATABASE if j.id == req.job_id), None)
    
    cand_name = candidate.profile.full_name if candidate else "Candidate"
    job_title = job.title if job else "Software Engineer Position"

    # Derive key technical skills for custom questions
    required_skills = (job.required_skills if job and job.required_skills else (candidate.profile.skills[:3] if candidate else ["Python", "Problem Solving"]))
    skills_str = ", ".join(required_skills[:3])

    questions = [
        InterviewQuestion(
            id="q1",
            stage="experience",
            question_text=f"Welcome {cand_name}! I am your AI Voice Interviewer for the {job_title} role. To start, please introduce yourself and summarize your relevant work experience.",
            expected_aspects=["years of experience", "past roles", "key projects"]
        ),
        InterviewQuestion(
            id="q2",
            stage="capability",
            question_text=f"Great. Next, let's test your technical capability. Could you explain your hands-on experience with {skills_str}, and describe a challenging technical problem you solved using these skills?",
            expected_aspects=["technical depth", "problem solving", "skills application"]
        ),
        InterviewQuestion(
            id="q3",
            stage="qa",
            question_text=f"Thank you. Now it's your turn — do you have any questions about the {job_title} role, our team, or technical stack that I can clarify for you?",
            expected_aspects=["candidate curiosity", "role clarity", "culture alignment"]
        )
    ]

    session_id = f"int-{uuid.uuid4().hex[:8]}"
    initial_turn = InterviewTurn(
        speaker="agent",
        text=questions[0].question_text,
        timestamp=datetime.datetime.now().strftime("%H:%M:%S"),
        stage="experience"
    )

    session = InterviewSession(
        session_id=session_id,
        candidate_id=req.candidate_id,
        candidate_name=cand_name,
        job_id=req.job_id,
        job_title=job_title,
        status="In Progress",
        created_at=datetime.datetime.now().isoformat(),
        questions=questions,
        turns=[initial_turn]
    )

    INTERVIEW_SESSIONS_DATABASE[session_id] = session
    return session


@app.post("/api/interview/turn")
def process_interview_turn(req: InterviewTurnRequest):
    """Process candidate's voice answer, log speech data, and return next AI agent question/response."""
    session = INTERVIEW_SESSIONS_DATABASE.get(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Interview session not found")

    now_str = datetime.datetime.now().strftime("%H:%M:%S")

    # Record candidate's answer
    candidate_turn = InterviewTurn(
        speaker="candidate",
        text=req.candidate_speech_text,
        timestamp=now_str,
        stage=req.stage
    )
    session.turns.append(candidate_turn)

    next_q_idx = req.current_question_index + 1
    is_complete = next_q_idx >= len(session.questions)

    if not is_complete:
        next_question = session.questions[next_q_idx]
        agent_turn = InterviewTurn(
            speaker="agent",
            text=next_question.question_text,
            timestamp=now_str,
            stage=next_question.stage
        )
        session.turns.append(agent_turn)

        return {
            "session_id": session.session_id,
            "next_question": next_question.question_text,
            "question_index": next_q_idx,
            "is_complete": False,
            "agent_speech": next_question.question_text
        }
    else:
        closing_text = "Thank you for completing the voice interview! I have recorded your responses and video data for performance and cheating analysis. Our HR team will review your application shortly."
        agent_turn = InterviewTurn(
            speaker="agent",
            text=closing_text,
            timestamp=now_str,
            stage="complete"
        )
        session.turns.append(agent_turn)

        return {
            "session_id": session.session_id,
            "next_question": None,
            "question_index": next_q_idx,
            "is_complete": True,
            "agent_speech": closing_text
        }


@app.post("/api/interview/evaluate", response_model=InterviewSession)
def evaluate_interview_session(req: InterviewEvaluateRequest):
    """Evaluate candidate's voice performance and generate cheating analysis report."""
    session = INTERVIEW_SESSIONS_DATABASE.get(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Interview session not found")

    candidate_turns = [t for t in session.turns if t.speaker == "candidate"]
    total_words = sum(len(t.text.split()) for t in candidate_turns)
    cand_text_combined = " ".join([t.text for t in candidate_turns])

    # LLM or Heuristic Voice & Capability Assessment
    comm_score = min(98.0, max(60.0, 75.0 + (total_words / 15.0)))
    tech_score = 85.0 if any(kw in cand_text_combined.lower() for kw in ["python", "project", "experience", "built", "system", "design", "team", "api", "data", "model", "code"]) else 72.0

    strengths = []
    if total_words > 40:
        strengths.append("Articulate and detailed responses during voice interaction")
    else:
        strengths.append("Concise and direct answers")
    
    if any(kw in cand_text_combined.lower() for kw in ["problem", "solve", "architecture", "optimized", "scale"]):
        strengths.append("Strong technical problem-solving focus")

    voice_eval = VoiceAssessment(
        communication_score=round(comm_score, 1),
        technical_capability_score=round(tech_score, 1),
        confidence_rating="High Confidence" if total_words > 50 else "Moderate Confidence",
        rationale=f"Candidate demonstrated clear verbal communication across {len(candidate_turns)} response turns. Technical capability score ({round(tech_score,1)}%) reflects solid domain alignment with role requirements.",
        strengths=strengths,
        areas_for_improvement=["Provide more quantitative metrics for past project achievements."]
    )

    # Cheating Analysis calculation
    risk_score = 5.0 + (req.tab_switches * 25.0) + (req.suspicious_silences * 15.0) + (req.gaze_anomalies * 10.0)
    risk_score = min(100.0, risk_score)

    flags = []
    if req.tab_switches > 0:
        flags.append(f"Tab switch / window blur detected {req.tab_switches} time(s) during interview")
    if req.suspicious_silences > 0:
        flags.append(f"Extended unprompted silence detected {req.suspicious_silences} time(s)")
    if req.gaze_anomalies > 0:
        flags.append(f"Frequent off-screen gaze shifts detected {req.gaze_anomalies} time(s)")

    if risk_score >= 50.0:
        risk_level = "High Risk"
        summary = "Potential cheating risk detected: candidate switched tab or lost window focus during question answering."
    elif risk_score >= 25.0:
        risk_level = "Medium Risk"
        summary = "Minor anomaly flags raised during video call. HR review of recorded video recommended."
    else:
        risk_level = "Low Risk"
        summary = "Normal candidate behavior. Candidate maintained continuous video focus and webcam alignment throughout the session."

    cheating_eval = CheatingReport(
        cheating_risk_score=round(risk_score, 1),
        risk_level=risk_level,
        tab_switches=req.tab_switches,
        suspicious_silences=req.suspicious_silences,
        gaze_anomalies=req.gaze_anomalies,
        flags=flags,
        summary=summary
    )

    session.voice_assessment = voice_eval
    session.cheating_report = cheating_eval
    session.status = "Completed"

    # Update candidate application status
    for app in APPLICATIONS_DATABASE:
        if app.candidate_id == session.candidate_id and app.job_id == session.job_id:
            app.status = "Interview Completed"

    # Update invitation status
    for inv in INVITATIONS_DATABASE:
        if inv.candidate_id == session.candidate_id and inv.job_id == session.job_id:
            inv.status = "Completed"

    return session


@app.post("/api/interview/upload-video")
async def upload_interview_video(session_id: str = Form(...), file: UploadFile = File(...)):
    """Upload recorded WebM video stream of the candidate interview."""
    session = INTERVIEW_SESSIONS_DATABASE.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Interview session not found")

    ext = ".webm" if "webm" in (file.content_type or "") else ".mp4"
    filename = f"{session_id}_video{ext}"
    filepath = os.path.join(INTERVIEW_VIDEOS_DIR, filename)

    contents = await file.read()
    with open(filepath, "wb") as f:
        f.write(contents)

    session.video_filename = filename
    return {"status": "success", "video_filename": filename, "video_url": f"/interview_videos/{filename}"}


@app.get("/api/interview/session/{session_id}", response_model=InterviewSession)
def get_interview_session(session_id: str):
    """Retrieve interview session details, evaluation, and video info."""
    session = INTERVIEW_SESSIONS_DATABASE.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Interview session not found")
    return session


# Multi-Agent Pipeline Endpoints
@app.get("/api/orchestrate/f2f-briefing/{candidate_id}/{job_id}")
def get_hiring_manager_f2f_briefing(candidate_id: str, job_id: str):
    """Stage 4 Agent Endpoint: Generates a tailored Hiring Manager Face-to-Face Interview Briefing.
    Cross-examines Stage 1 requirements, Stage 2 match gaps, and Stage 3 voice interview results.
    """
    # 1. Retrieve Candidate Record
    candidates = vector_store.list_all_candidates()
    cand_record = next((c for c in candidates if c.id == candidate_id), None)
    if not cand_record:
        raise HTTPException(status_code=404, detail=f"Candidate '{candidate_id}' not found.")

    # 2. Retrieve Job Description
    job_item = next((j for j in SAMPLE_JOBS if j.get("id") == job_id), None)
    if not job_item:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")
    
    job_desc = JobDescription(**job_item)

    # 3. Retrieve Candidate Match Analysis
    match_analyses = matcher.match_candidates(job_desc, candidate_records=[cand_record])
    match_analysis = match_analyses[0] if match_analyses else None
    if not match_analysis:
        raise HTTPException(status_code=500, detail="Failed to run candidate match analysis.")

    # 4. Check for completed Stage 3 Voice Interview session
    interview_session = next((s for s in INTERVIEW_SESSIONS_DATABASE.values() if s.candidate_id == candidate_id and s.job_id == job_id), None)

    # 5. Run Stage 4 Agent
    from backend.agents import MultiAgentOrchestrator
    orchestrator = MultiAgentOrchestrator(vector_store)
    briefing = orchestrator.orchestrate_stage4_briefing(
        job=job_desc,
        candidate=cand_record.profile,
        match_analysis=match_analysis,
        interview_session=interview_session
    )

    return briefing


@app.get("/api/interview/candidate/{candidate_id}")
def get_candidate_interview_history(candidate_id: str):
    """Get all interview sessions for a specific candidate."""
    sessions = [s for s in INTERVIEW_SESSIONS_DATABASE.values() if s.candidate_id == candidate_id]
    return sessions


@app.get("/api/hr/completed-interviews", response_model=List[InterviewSession])
def get_all_completed_interviews():
    """Retrieve all completed interview sessions for HR video review and score evaluation."""
    completed = []
    for s in INTERVIEW_SESSIONS_DATABASE.values():
        if s.status == "Completed" or len([t for t in s.turns if t.speaker == "candidate"]) > 0:
            if not s.voice_assessment or not s.cheating_report:
                # Auto-generate evaluation if candidate turns exist
                cand_turns = [t for t in s.turns if t.speaker == "candidate"]
                word_count = sum(len(t.text.split()) for t in cand_turns)
                s.voice_assessment = VoiceAssessment(
                    communication_score=round(min(98.0, max(65.0, 75.0 + word_count/10.0)), 1),
                    technical_capability_score=82.0,
                    confidence_rating="High Confidence" if word_count > 30 else "Moderate Confidence",
                    rationale="Candidate completed voice interview turn interaction.",
                    strengths=["Clear voice communication"],
                    areas_for_improvement=[]
                )
                s.cheating_report = CheatingReport(
                    cheating_risk_score=5.0,
                    risk_level="Low Risk",
                    tab_switches=0,
                    suspicious_silences=0,
                    gaze_anomalies=0,
                    flags=[],
                    summary="No suspicious flags recorded."
                )
                s.status = "Completed"
            completed.append(s)

    completed.sort(key=lambda x: x.created_at, reverse=True)
    return completed


# In-memory storage for invitations
INVITATIONS_DATABASE: List[InterviewInvitation] = []

class AuthLoginRequest(BaseModel):
    email: str
    role: Optional[str] = "candidate"

class InviteCandidateRequest(BaseModel):
    candidate_id: str
    job_id: str
    candidate_email: Optional[str] = None


@app.post("/api/auth/login", response_model=UserAccount)
def user_login(req: AuthLoginRequest):
    """Sign in HR (hr@db.com) or candidate (candidate@gmail.com). Auto-assigns or creates account."""
    email_clean = req.email.strip().lower()

    if email_clean == "hr@db.com":
        return UserAccount(
            email="hr@db.com",
            name="HR Manager (DB)",
            role="hr"
        )
    
    # Candidate login (e.g. candidate@gmail.com)
    all_candidates = vector_store.list_all_candidates()
    matched_cand = next((c for c in all_candidates if c.profile.email and c.profile.email.strip().lower() == email_clean), None)

    cand_id = matched_cand.id if matched_cand else (all_candidates[0].id if all_candidates else "cand-001")
    cand_name = matched_cand.profile.full_name if matched_cand else "Candidate"

    return UserAccount(
        email=email_clean,
        name=cand_name,
        role="candidate",
        candidate_id=cand_id
    )


@app.post("/api/interview/invite", response_model=InterviewInvitation)
def invite_candidate_to_interview(req: InviteCandidateRequest):
    """HR dispatches an interview invitation to the candidate's inbox."""
    candidate = vector_store.get_candidate(req.candidate_id)
    job = next((j for j in JOBS_DATABASE if j.id == req.job_id), None)

    cand_name = candidate.profile.full_name if candidate else "Candidate"
    cand_email = req.candidate_email or (candidate.profile.email if candidate and candidate.profile.email else "candidate@gmail.com")
    job_title = job.title if job else "Software Engineer Position"

    # Check if invitation already exists
    existing = next((inv for inv in INVITATIONS_DATABASE if inv.candidate_id == req.candidate_id and inv.job_id == req.job_id), None)
    if existing:
        return existing

    invitation = InterviewInvitation(
        invitation_id=f"inv-{uuid.uuid4().hex[:8]}",
        candidate_email=cand_email,
        candidate_id=req.candidate_id,
        candidate_name=cand_name,
        job_id=req.job_id,
        job_title=job_title,
        status="Pending",
        created_at=datetime.datetime.now().isoformat()
    )

    INVITATIONS_DATABASE.append(invitation)

    # Update candidate application status
    for app in APPLICATIONS_DATABASE:
        if app.candidate_id == req.candidate_id and app.job_id == req.job_id:
            app.status = "Interview Invited"

    return invitation


@app.get("/api/candidate/inbox", response_model=List[InterviewInvitation])
def get_candidate_inbox(email: Optional[str] = "candidate@gmail.com"):
    """Get interview invitations in candidate inbox."""
    email_clean = (email or "candidate@gmail.com").strip().lower()
    
    # Return invitations matching email or all invitations if candidate@gmail.com
    if email_clean == "candidate@gmail.com":
        return INVITATIONS_DATABASE
    
    return [inv for inv in INVITATIONS_DATABASE if inv.candidate_email.lower() == email_clean]


# In-memory storage for physical/on-site interviews
PHYSICAL_INTERVIEWS_DATABASE: List[PhysicalInterviewSchedule] = []

class UpdateStageRequest(BaseModel):
    candidate_id: str
    job_id: str
    stage: str  # "Screening", "AI Interview", "Physical Interview", "Selected", "Rejected"

class SchedulePhysicalRequest(BaseModel):
    candidate_id: str
    job_id: str
    scheduled_time: str
    location: Optional[str] = "Headquarters - Meeting Room 4A"
    notes: Optional[str] = "Technical On-Site Interview & System Architecture Round"


@app.post("/api/applications/update-stage")
def update_application_stage(req: UpdateStageRequest):
    """Update candidate's hiring stage in the recruitment pipeline."""
    for app in APPLICATIONS_DATABASE:
        if app.candidate_id == req.candidate_id and app.job_id == req.job_id:
            app.status = req.stage
            return {"status": "success", "candidate_id": req.candidate_id, "new_stage": req.stage}

    # If application record doesn't exist yet, create one
    candidate = vector_store.get_candidate(req.candidate_id)
    cand_name = candidate.profile.full_name if candidate else "Candidate"
    new_app = JobApplication(
        id=f"app-{uuid.uuid4().hex[:6]}",
        job_id=req.job_id,
        candidate_id=req.candidate_id,
        candidate_name=cand_name,
        applied_at=datetime.datetime.now().isoformat(),
        status=req.stage
    )
    APPLICATIONS_DATABASE.append(new_app)
    return {"status": "success", "candidate_id": req.candidate_id, "new_stage": req.stage}


@app.post("/api/physical-interview/schedule", response_model=PhysicalInterviewSchedule)
def schedule_physical_interview(req: SchedulePhysicalRequest):
    """Schedule physical/on-site interview for a candidate."""
    candidate = vector_store.get_candidate(req.candidate_id)
    job = next((j for j in JOBS_DATABASE if j.id == req.job_id), None)

    cand_name = candidate.profile.full_name if candidate else "Candidate"
    job_title = job.title if job else "Software Engineer Position"

    schedule = PhysicalInterviewSchedule(
        schedule_id=f"phys-{uuid.uuid4().hex[:8]}",
        candidate_id=req.candidate_id,
        candidate_name=cand_name,
        job_id=req.job_id,
        job_title=job_title,
        location=req.location or "Headquarters - Meeting Room 4A",
        scheduled_time=req.scheduled_time,
        interviewer_notes=req.notes or "Technical On-Site Interview & System Architecture Round",
        status="Scheduled",
        created_at=datetime.datetime.now().isoformat()
    )

    PHYSICAL_INTERVIEWS_DATABASE.append(schedule)

    # Update application status to Physical Interview
    for app_item in APPLICATIONS_DATABASE:
        if app_item.candidate_id == req.candidate_id and app_item.job_id == req.job_id:
            app_item.status = "Physical Interview"

    return schedule


@app.get("/api/physical-interview/list", response_model=List[PhysicalInterviewSchedule])
def get_physical_interviews():
    """List scheduled physical/on-site interviews for HR."""
    return PHYSICAL_INTERVIEWS_DATABASE


@app.get("/api/jobs/{job_id}/pipeline-summary")
def get_job_pipeline_summary(job_id: str):
    """Get live candidate count per pipeline stage for the interactive Stage Graph."""
    job = next((j for j in JOBS_DATABASE if j.id == job_id), None)
    if not job:
        raise HTTPException(status_code=404, detail="Job position not found")

    all_candidates = vector_store.list_all_candidates()
    app_map = {a.candidate_id: a.status for a in APPLICATIONS_DATABASE if a.job_id == job_id}
    completed_interviews = {s.candidate_id: s for s in INTERVIEW_SESSIONS_DATABASE.values() if s.job_id == job_id and s.status == "Completed"}

    counts = {
        "screening": len(all_candidates),
        "ai_interview": len([c for c in all_candidates if app_map.get(c.id) in ["Interview Invited", "Interview Completed"] or c.id in completed_interviews]),
        "physical_interview": len([c for c in all_candidates if app_map.get(c.id) == "Physical Interview" or any(p.candidate_id == c.id for p in PHYSICAL_INTERVIEWS_DATABASE if p.job_id == job_id)]),
        "selection": len([c for c in all_candidates if app_map.get(c.id) in ["Selected", "Shortlisted for Interview"]])
    }

    return {
        "job_id": job_id,
        "job_title": job.title,
        "counts": counts
    }




# Mount static files directories
if os.path.exists(INTERVIEW_VIDEOS_DIR):
    app.mount("/interview_videos", StaticFiles(directory=INTERVIEW_VIDEOS_DIR), name="interview_videos")

if os.path.exists("./static"):
    app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/", response_class=HTMLResponse)
def read_root():
    """Serve web dashboard HTML."""
    if os.path.exists("./static/index.html"):
        with open("./static/index.html", "r", encoding="utf-8") as f:
            return f.read()
    return "<h1>AI Resume Parser & Candidate Matcher API Running</h1><p>Visit <a href='/docs'>/docs</a> for API Swagger documentation.</p>"



