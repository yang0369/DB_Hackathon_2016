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
    JDKeyRequirements,
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


