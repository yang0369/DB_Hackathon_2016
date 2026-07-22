import os
import json
import re
from typing import List, Dict, Any, Optional
from backend.models import CandidateRecord, JobDescription, MatchAnalysis
from backend.vector_store import VectorStore

# Try importing google.genai SDK
try:
    from google import genai
    from google.genai import types
    GENAI_AVAILABLE = True
except ImportError:
    GENAI_AVAILABLE = False


# Skill Synonym/Alias Map for normalization
SKILL_ALIASES = {
    "js": "javascript",
    "javascript": "javascript",
    "ts": "typescript",
    "typescript": "typescript",
    "py": "python",
    "python": "python",
    "react": "react",
    "react.js": "react",
    "reactjs": "react",
    "node": "node.js",
    "node.js": "node.js",
    "nodejs": "node.js",
    "postgres": "postgresql",
    "postgresql": "postgresql",
    "mongo": "mongodb",
    "mongodb": "mongodb",
    "ml": "machine learning",
    "machine learning": "machine learning",
    "ai": "artificial intelligence",
    "artificial intelligence": "artificial intelligence",
    "llm": "llm",
    "llms": "llm",
    "large language models": "llm",
    "rag": "rag",
    "fastapi": "fastapi",
    "fast api": "fastapi",
    "rest": "rest api",
    "rest api": "rest api",
    "restful api": "rest api",
    "gcp": "google cloud",
    "google cloud": "google cloud",
    "aws": "aws",
    "k8s": "kubernetes",
    "kubernetes": "kubernetes",
    "docker": "docker",
    "sql": "sql",
}

def normalize_skill(s: str) -> str:
    cleaned = re.sub(r'[^\w\s]', '', s.lower().strip())
    return SKILL_ALIASES.get(cleaned, cleaned)

def is_skill_match(cand_skill: str, target_skill: str) -> bool:
    c_norm = normalize_skill(cand_skill)
    t_norm = normalize_skill(target_skill)
    if c_norm == t_norm:
        return True
    
    # Substring / word boundary check
    c_raw = cand_skill.lower().strip()
    t_raw = target_skill.lower().strip()
    if t_raw in c_raw or c_raw in t_raw:
        return True
    return False


class CandidateMatcher:
    def __init__(self, vector_store: VectorStore):
        self.vector_store = vector_store

    def calculate_skill_match(
        self,
        candidate_skills: List[str],
        required_skills: List[str],
        preferred_skills: Optional[List[str]] = None,
        skill_weights: Optional[Dict[str, float]] = None
    ) -> Dict[str, Any]:
        """Check required & preferred skill coverage with custom HR skill weights."""
        if preferred_skills is None:
            preferred_skills = []
        if skill_weights is None:
            skill_weights = {}

        matched_req = []
        missing_req = []
        breakdown = []

        total_weight = 0.0
        weighted_matched_score_sum = 0.0

        for req in required_skills:
            w = float(skill_weights.get(req, 1.0))
            total_weight += w
            is_matched = any(is_skill_match(cs, req) for cs in candidate_skills)
            skill_indiv_score = 100.0 if is_matched else 0.0
            
            if is_matched:
                matched_req.append(req)
                weighted_matched_score_sum += (100.0 * w)
            else:
                missing_req.append(req)

            breakdown.append({
                "skill": req,
                "weight": round(w, 1),
                "matched": is_matched,
                "score": skill_indiv_score,
                "type": "required"
            })

        coverage_pct = (len(matched_req) / len(required_skills) * 100.0) if required_skills else 100.0

        matched_pref = []
        for pref in preferred_skills:
            w = float(skill_weights.get(pref, 0.5))
            is_matched = any(is_skill_match(cs, pref) for cs in candidate_skills)
            if is_matched:
                matched_pref.append(pref)
            breakdown.append({
                "skill": pref,
                "weight": round(w, 1),
                "matched": is_matched,
                "score": 100.0 if is_matched else 0.0,
                "type": "preferred"
            })

        # Calculate weighted skill score
        if total_weight > 0:
            weighted_skill_score = round(weighted_matched_score_sum / total_weight, 1)
        else:
            weighted_skill_score = round(coverage_pct, 1)

        # Unweighted skill match score
        pref_bonus = (len(matched_pref) / len(preferred_skills) * 15.0) if preferred_skills else 0.0
        skill_score = min(100.0, (coverage_pct * 0.85) + pref_bonus) if required_skills else 100.0

        return {
            "matched_skills": matched_req,
            "missing_skills": missing_req,
            "preferred_matched_skills": matched_pref,
            "coverage_pct": round(coverage_pct, 1),
            "skill_match_score": round(skill_score, 1),
            "weighted_skill_score": weighted_skill_score,
            "skill_scores_breakdown": breakdown
        }

    def calculate_qualification_match(
        self,
        candidate_exp_years: float,
        min_years_exp: float
    ) -> Dict[str, Any]:
        """Evaluate candidate work experience qualification against required minimum."""
        req_years = min_years_exp or 0.0
        cand_years = candidate_exp_years or 0.0

        if req_years <= 0:
            exp_met = True
            score = 100.0
            summary = f"{cand_years:.1f} Yrs total experience"
        elif cand_years >= req_years:
            exp_met = True
            score = 100.0
            summary = f"Meets requirement ({cand_years:.1f} Yrs vs {req_years:.1f} Yrs required)"
        else:
            exp_met = False
            ratio = cand_years / req_years if req_years > 0 else 1.0
            score = round(max(0.0, ratio * 100.0), 1)
            summary = f"Short of requirement ({cand_years:.1f} Yrs vs {req_years:.1f} Yrs required)"

        return {
            "experience_met": exp_met,
            "qualification_score": score,
            "experience_summary": summary
        }

    def calculate_availability_match(self, cand_avail: Optional[str], req_avail: Optional[str]) -> Dict[str, Any]:
        """Evaluate availability fit."""
        c_avail = cand_avail or "Immediate"
        r_avail = req_avail or "Any"

        if r_avail == "Any" or c_avail.lower() == r_avail.lower() or c_avail == "Immediate":
            return {"score": 100.0, "matched": True, "summary": f"Availability fits: {c_avail}"}
        elif "2 week" in c_avail.lower() and "1 month" in r_avail.lower():
            return {"score": 100.0, "matched": True, "summary": f"Available sooner than required ({c_avail})"}
        elif "1 month" in c_avail.lower() and "immediate" in r_avail.lower():
            return {"score": 50.0, "matched": False, "summary": f"Requires 1 month notice (Job requests {r_avail})"}
        else:
            return {"score": 75.0, "matched": True, "summary": f"Availability: {c_avail}"}

    def calculate_nationality_match(self, cand_nat: Optional[str], req_nat: Optional[str]) -> Dict[str, Any]:
        """Evaluate nationality / location fit."""
        c_nat = cand_nat or "Any / Citizen"
        r_nat = req_nat or "Any"

        if r_nat == "Any" or c_nat.lower() == r_nat.lower() or "any" in c_nat.lower():
            return {"score": 100.0, "matched": True, "summary": f"Status match: {c_nat}"}
        elif ("singapore" in r_nat.lower() or "pr" in r_nat.lower()) and ("singapore" in c_nat.lower() or "pr" in c_nat.lower()):
            return {"score": 100.0, "matched": True, "summary": f"Matches Singapore Citizen/PR requirement"}
        elif ("us" in r_nat.lower() or "green card" in r_nat.lower()) and ("us" in c_nat.lower() or "green card" in c_nat.lower()):
            return {"score": 100.0, "matched": True, "summary": f"Matches US Work Authorization"}
        else:
            return {"score": 70.0, "matched": True, "summary": f"Status: {c_nat} (Job requires {r_nat})"}

    def generate_hr_evaluation(
        self,
        candidate_record: CandidateRecord,
        job_description: JobDescription,
        semantic_sim: float,
        skill_info: Dict[str, Any]
    ) -> MatchAnalysis:
        """Generate AI evaluation summary and HR recommendation with strong emphasis on weighted skills & criteria."""
        profile = candidate_record.profile
        api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")

        matched_skills = skill_info["matched_skills"]
        missing_skills = skill_info["missing_skills"]
        pref_matched = skill_info["preferred_matched_skills"]
        skill_coverage = skill_info["coverage_pct"]
        skill_score = skill_info["skill_match_score"]
        weighted_skill_score = skill_info["weighted_skill_score"]
        skill_breakdown = skill_info["skill_scores_breakdown"]

        qual_info = self.calculate_qualification_match(
            candidate_exp_years=profile.years_of_experience,
            min_years_exp=job_description.min_years_experience
        )
        qual_score = qual_info["qualification_score"]

        avail_info = self.calculate_availability_match(profile.availability, job_description.required_availability)
        nat_info = self.calculate_nationality_match(profile.nationality, job_description.required_nationality)

        # Composite Match Score: 55% Weighted Skills + 25% Qualification/Experience + 10% Availability + 10% Nationality
        composite_score = round(
            (weighted_skill_score * 0.55) +
            (qual_score * 0.25) +
            (avail_info["score"] * 0.10) +
            (nat_info["score"] * 0.10),
            1
        )

        strengths = []
        if matched_skills:
            strengths.append(f"Matched {len(matched_skills)} required skills (Weighted Score: {weighted_skill_score}%)")
        if pref_matched:
            strengths.append(f"Matched preferred skills: {', '.join(pref_matched[:3])}")
        if qual_info["experience_met"]:
            strengths.append(f"Experience: {qual_info['experience_summary']}")
        if avail_info["matched"]:
            strengths.append(f"Availability: {avail_info['summary']}")

        gaps = []
        if missing_skills:
            gaps.append(f"Missing required skills: {', '.join(missing_skills)}")
        if not qual_info["experience_met"]:
            gaps.append(f"Experience gap: {qual_info['experience_summary']}")
        if not avail_info["matched"]:
            gaps.append(f"Availability constraint: {avail_info['summary']}")
        if not gaps:
            gaps.append("No major skill, experience, or availability gaps identified.")

        if composite_score >= 75.0 and qual_info["experience_met"] and skill_coverage >= 50.0:
            hr_rec = "Highly Recommended"
            summary_proposal = f"Strong candidate for {job_description.title}. High weighted skill match ({weighted_skill_score}%) and meets qualification & availability requirements."
        elif composite_score >= 50.0:
            hr_rec = "Consider for Interview"
            summary_proposal = f"Moderate fit for {job_description.title}. Meets core requirements with minor skill or experience gaps."
        else:
            hr_rec = "Skip / Low Match"
            summary_proposal = f"Low alignment with {job_description.title}. Does not satisfy weighted skill and experience requirements."

        if api_key and GENAI_AVAILABLE:
            free_models = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-flash-latest"]
            client = genai.Client(api_key=api_key)
            prompt = f"""
You are an expert HR recruiter evaluating a candidate for a job opening.

Job Title: {job_description.title}
Job Description: {job_description.description[:1500]}
Required Skills & Weights: {json.dumps(job_description.skill_weights or job_description.required_skills)}
Target Interview Shortlist Count: {job_description.target_candidate_count}

Candidate Name: {profile.full_name}
Years Experience: {profile.years_of_experience}
Candidate Skills: {', '.join(profile.skills)}
Availability: {profile.availability}
Nationality/Status: {profile.nationality}

Match Analysis:
- Weighted Skill Score: {weighted_skill_score}%
- Matched Skills: {', '.join(matched_skills)}
- Missing Skills: {', '.join(missing_skills)}
- Experience Fit: {qual_info['experience_summary']}

Evaluate candidate fit for HR decision making and return JSON with keys:
- hr_recommendation: string ("Highly Recommended", "Consider for Interview", "Skip / Low Match")
- strengths: list of strings
- gaps: list of strings
- summary_rationale: string (2-3 sentences explaining rationale for HR interview selection)
"""
            for model_name in free_models:
                try:
                    response = client.models.generate_content(
                        model=model_name,
                        contents=prompt,
                        config=types.GenerateContentConfig(
                            response_mime_type="application/json",
                            temperature=0.2,
                        ),
                    )
                    if response.text:
                        eval_data = json.loads(response.text)
                        hr_rec = eval_data.get("hr_recommendation", hr_rec)
                        strengths = eval_data.get("strengths", strengths)
                        gaps = eval_data.get("gaps", gaps)
                        summary_proposal = eval_data.get("summary_rationale", summary_proposal)
                        break
                except Exception as e:
                    err_str = str(e)
                    if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                        # Rate limit reached for free tier; use structured scoring engine without spamming logs
                        break



        return MatchAnalysis(
            candidate_id=candidate_record.id,
            candidate_name=profile.full_name,
            job_id=job_description.id or "custom-job",
            job_title=job_description.title,
            match_score=composite_score,
            semantic_similarity=semantic_sim,
            skill_coverage=skill_coverage,
            skill_match_score=skill_score,
            weighted_skill_score=weighted_skill_score,
            skill_scores_breakdown=skill_breakdown,
            qualification_score=qual_score,
            availability_score=avail_info["score"],
            availability_matched=avail_info["matched"],
            candidate_availability=profile.availability or "Immediate",
            nationality_score=nat_info["score"],
            nationality_matched=nat_info["matched"],
            candidate_nationality=profile.nationality or "Any",
            matched_skills=matched_skills,
            missing_skills=missing_skills,
            preferred_matched_skills=pref_matched,
            experience_met=qual_info["experience_met"],
            experience_summary=qual_info["experience_summary"],
            strengths=strengths,
            gaps=gaps,
            hr_recommendation=hr_rec,
            summary_rationale=summary_proposal,
            selection_status="Applied"
        )

    def match_candidates_for_job(
        self,
        job_description: JobDescription,
        candidate_records: Optional[List[CandidateRecord]] = None,
        top_k: int = 100
    ) -> List[MatchAnalysis]:
        """Rank and generate HR proposals for candidates against a job description."""
        if candidate_records is not None:
            query_text = f"{job_description.title} {' '.join(job_description.required_skills)} {' '.join(job_description.preferred_skills)} {job_description.description}"
            query_embedding = self.vector_store._get_embedding(query_text)
            
            search_results = []
            for record in candidate_records:
                doc_text = f"{record.profile.summary} {' '.join(record.profile.skills)} {record.raw_text[:2000]}"
                doc_embedding = self.vector_store._get_embedding(doc_text)
                dot_product = sum(a * b for a, b in zip(query_embedding, doc_embedding))
                sim_score = max(0.0, min(100.0, round(dot_product * 100.0, 1)))
                search_results.append({
                    "candidate_id": record.id,
                    "candidate_record": record,
                    "similarity": sim_score
                })
        else:
            query_text = f"{job_description.title} {' '.join(job_description.required_skills)} {' '.join(job_description.preferred_skills)} {job_description.description}"
            search_results = self.vector_store.search_candidates(query_text, top_k=top_k)

        match_analyses = []
        for res in search_results:
            record: CandidateRecord = res["candidate_record"]
            similarity = res["similarity"]
            
            skill_info = self.calculate_skill_match(
                candidate_skills=record.profile.skills,
                required_skills=job_description.required_skills,
                preferred_skills=job_description.preferred_skills,
                skill_weights=job_description.skill_weights
            )

            analysis = self.generate_hr_evaluation(
                candidate_record=record,
                job_description=job_description,
                semantic_sim=similarity,
                skill_info=skill_info
            )
            match_analyses.append(analysis)

        match_analyses.sort(key=lambda x: x.match_score, reverse=True)

        target_count = job_description.target_candidate_count or 3
        for idx, item in enumerate(match_analyses):
            item.rank_position = idx + 1
            if idx < target_count:
                item.is_top_candidate = True
            else:
                item.is_top_candidate = False

        return match_analyses



