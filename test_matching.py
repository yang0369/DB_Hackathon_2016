import os
import sys
import json
from backend.models import JobDescription
from backend.vector_store import VectorStore
from backend.matcher import CandidateMatcher
from seed_data import seed_sample_candidates

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

def run_direct_matching_test():
    print("Initializing VectorStore and Seeding Sample Candidates...")
    vs = VectorStore()
    seed_sample_candidates(vs)
    matcher = CandidateMatcher(vs)

    job = JobDescription(
        id="job-python-sr",
        title="Senior Python Backend Engineer",
        department="Engineering",
        required_skills=["Python", "FastAPI", "SQL", "Docker", "REST API"],
        preferred_skills=["ChromaDB", "Kubernetes", "Google Cloud"],
        min_years_experience=4.0,
        salary_min=120000.0,
        salary_max=160000.0,
        salary_currency="$",
        target_candidate_count=2,
        education_level="Bachelor's Degree",
        description="Seeking Senior Python Engineer with microservices, FastAPI, and Docker experience."
    )

    print(f"\nTesting Matcher against Job: '{job.title}'")
    print(f"Salary Range: ${job.salary_min:,.0f} - ${job.salary_max:,.0f}")
    print(f"Target Top Candidates to Suggest (X): {job.target_candidate_count}")
    print(f"Required Skills: {job.required_skills}")
    print(f"Min Experience: {job.min_years_experience} Years\n")

    results = matcher.match_candidates_for_job(job)

    print("=== DUAL PORTAL APPLICANT EVALUATION RESULTS ===")
    for i, m in enumerate(results, 1):
        top_tag = f"[TOP CANDIDATE SUGGESTION #{m.rank_position}]" if m.is_top_candidate else f"[Rank #{m.rank_position}]"
        print(f"#{i} {m.candidate_name} {top_tag}")
        print(f"    Match Score: {m.match_score}% (Skill Score: {m.skill_match_score}%, SemSim: {m.semantic_similarity}%)")
        print(f"    Experience Status: {m.experience_summary} (Met: {m.experience_met})")
        print(f"    Matched Required Skills: {m.matched_skills}")
        print(f"    Matched Preferred Skills: {m.preferred_matched_skills}")
        print(f"    Missing Required Skills: {m.missing_skills}")
        print(f"    Recommendation: {m.hr_recommendation}")
        print(f"    Rationale: {m.summary_rationale}\n")

if __name__ == "__main__":
    run_direct_matching_test()



