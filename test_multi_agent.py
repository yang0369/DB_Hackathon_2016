import sys
import os

# Add project root to sys.path
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from backend.models import (
    CandidateProfile,
    CandidateRecord,
    JobDescription,
    HardCriteria,
    InterviewSession,
    InterviewTurn
)
from backend.agents import (
    DocumentParserAgent,
    ResumeMatchingAgent,
    CandidateEvaluationAgent,
    VoiceInterviewAgent,
    HiringManagerQAAgent,
    MultiAgentOrchestrator
)

def test_multi_agent_pipeline():
    print("=== Testing 4-Stage Multi-Agent Orchestration Pipeline ===")

    # 1. Stage 1: Document Parser Agent
    doc_agent = DocumentParserAgent()
    sample_jd_text = """
    Senior Python Developer (AI Infrastructure)
    Department: Core Engineering
    Location: Singapore (Singapore Citizen or PR required)
    Salary Budget: SGD 120,000 - 150,000 per annum
    Notice Period: Maximum 2 Weeks Notice required

    Requirements:
    - Minimum 5+ years of experience with Python, FastAPI, and PostgreSQL.
    - Strong background in LLM orchestration, RAG, and Vector Databases (ChromaDB, Pinecone).
    - Hands-on experience with Docker, Kubernetes, and AWS cloud services.
    - Mandatory Bachelor's degree in Computer Science, Software Engineering, or related STEM field.
    """

    print("\n---> Running Stage 1: Document Parser Agent...")
    jd_requirements = doc_agent.extract_job_requirements(sample_jd_text)
    print(f"Extracted Key Skills: {jd_requirements.key_skills}")
    print(f"Hard Criteria Nationality: {jd_requirements.hard_criteria.mandatory_nationality if jd_requirements.hard_criteria else 'Any'}")
    print(f"Hard Criteria Notice Period: {jd_requirements.hard_criteria.max_notice_period if jd_requirements.hard_criteria else 'Any'}")

    sample_resume = """
    Alex Tan
    Email: alex.tan@gmail.com | Phone: +65 9123 4567
    Singapore Citizen | Availability: 2 Weeks Notice
    Expected Salary: SGD 130,000

    Professional Summary:
    Senior Software Engineer with 6 years of experience building scalable backend APIs and AI pipelines.
    Expertise in Python, FastAPI, PostgreSQL, Docker, and LLM Applications.

    Skills:
    Python, FastAPI, PostgreSQL, Docker, AWS, RAG, Large Language Models, Vector Databases, Git, CI/CD

    Education:
    Bachelor of Science in Computer Science, National University of Singapore (NUS)
    """

    candidate_profile = doc_agent.parse_resume(sample_resume, "alex_tan.pdf")
    print(f"Parsed Candidate Name: {candidate_profile.full_name}")
    print(f"Parsed Candidate Skills ({len(candidate_profile.skills)}): {candidate_profile.skills}")
    print(f"Parsed Availability: {candidate_profile.availability} | Nationality: {candidate_profile.nationality}")

    # 2. Stage 2: Resume Matching & Candidate Evaluation Agents
    print("\n---> Running Stage 2A & 2B: Resume Matching & Candidate Evaluation Agents...")
    job = JobDescription(
        id="job-python-001",
        title="Senior Python Developer",
        required_skills=["Python", "FastAPI", "PostgreSQL", "LLM", "Docker", "Kubernetes"],
        min_years_experience=5.0,
        required_nationality="Singapore Citizen / PR",
        required_availability="2 Weeks Notice",
        description=sample_jd_text,
        jd_key_requirements=jd_requirements
    )

    cand_record = CandidateRecord(
        id="cand-001",
        profile=candidate_profile,
        raw_text=sample_resume,
        file_name="alex_tan.pdf",
        created_at="2026-07-23T12:00:00"
    )

    orchestrator = MultiAgentOrchestrator()
    match_analysis = orchestrator.orchestrate_matching_pipeline(cand_record, job)

    print(f"Candidate Match Score: {match_analysis.match_score}%")
    print(f"Rule Score: {match_analysis.rule_based_score}% | LLM Score: {match_analysis.llm_match_score}%")
    print(f"Hard Criteria Passed: {match_analysis.hard_criteria_passed}")
    print(f"Matched Skills: {match_analysis.matched_skills}")
    print(f"Missing Skills: {match_analysis.missing_skills}")
    print(f"HR Recommendation: {match_analysis.hr_recommendation}")

    # 3. Stage 3: Voice & Evaluation Agent
    print("\n---> Running Stage 3: Voice Interview Assessment Agent...")
    session = InterviewSession(
        session_id="session-101",
        candidate_id="cand-001",
        candidate_name=candidate_profile.full_name,
        job_id="job-python-001",
        job_title=job.title,
        status="In Progress",
        created_at="2026-07-23T12:30:00",
        turns=[
            InterviewTurn(speaker="agent", text="Welcome! Tell us about your Python and FastAPI experience.", timestamp="12:30:05"),
            InterviewTurn(speaker="candidate", text="I have built high-throughput backend services using Python and FastAPI for 6 years, deploying microservices with Docker and AWS.", timestamp="12:30:45"),
            InterviewTurn(speaker="agent", text="Great. How do you handle database connection pooling in PostgreSQL?", timestamp="12:31:00"),
            InterviewTurn(speaker="candidate", text="We used AsyncPG with SQLAlchemy async engine and PGBouncer for connection pooling to optimize DB queries.", timestamp="12:31:40")
        ]
    )

    voice_agent = VoiceInterviewAgent()
    evaluated_session = voice_agent.evaluate_session(session)
    print(f"Voice Communication Score: {evaluated_session.voice_assessment.communication_score}%")
    print(f"Voice Technical Score: {evaluated_session.voice_assessment.technical_capability_score}%")
    print(f"Cheating Risk Level: {evaluated_session.cheating_report.risk_level}")

    # 4. Stage 4: Hiring Manager Q&A Agent
    print("\n---> Running Stage 4: Hiring Manager Q&A Recommendation Agent...")
    hm_agent = HiringManagerQAAgent()
    briefing = hm_agent.generate_f2f_briefing(job, candidate_profile, match_analysis, evaluated_session)

    print(f"\nStage 4 Briefing Generated for: {briefing.candidate_name}")
    print(f"Weakly Demonstrated Competencies ({len(briefing.weak_competencies)}):")
    for wc in briefing.weak_competencies:
        print(f"  - [{wc.severity}] {wc.topic}: {wc.gap_description}")

    print(f"\nProposed F2F Questions for Hiring Manager ({len(briefing.proposed_f2f_questions)}):")
    for q in briefing.proposed_f2f_questions:
        print(f"  * Probe Topic: {q.competency}")
        print(f"    Question: \"{q.question}\"")
        print(f"    Signal Guide: {q.what_to_look_for}")

    print("\n[SUCCESS] All 4 Agent Stages Executed Successfully!")

if __name__ == "__main__":
    test_multi_agent_pipeline()
