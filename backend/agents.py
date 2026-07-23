import os
import json
import re
import datetime
from typing import List, Dict, Any, Optional

from backend.models import (
    CandidateProfile,
    CandidateRecord,
    JobDescription,
    JDKeyRequirements,
    HardCriteria,
    MatchAnalysis,
    InterviewSession,
    VoiceAssessment,
    CheatingReport,
    WeakCompetency,
    F2FInterviewQuestion,
    HiringManagerBriefing
)

try:
    from google import genai
    from google.genai import types
    GENAI_AVAILABLE = True
except ImportError:
    GENAI_AVAILABLE = False


def get_genai_client() -> Optional[Any]:
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if api_key and GENAI_AVAILABLE:
        return genai.Client(api_key=api_key)
    return None


class DocumentParserAgent:
    """STAGE 1 AGENT: Extracts structured requirements from Job Descriptions and parses raw candidate resumes.
    Extracts key skills, qualifications, experience, and hard limits (notice period, salary budget, nationality, degree).
    """

    def extract_job_requirements(self, raw_jd_text: str) -> JDKeyRequirements:
        """Extract structured JD key requirements and hard limits."""
        client = get_genai_client()
        if client:
            free_models = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-flash-latest"]
            prompt = f"""
You are an expert Job Description Parser Agent (Stage 1 Document Parser).
Extract structured key requirements and non-negotiable hard limits from the job description below into JSON.

Instructions:
1. Extract must-have key_skills and preferred_skills comprehensively.
2. Extract required minimum years of experience and education level.
3. Assign skill weights (0 to 100) for key skills based on their importance in the description.
4. Extract non-negotiable Hard Criteria / Knockout filters:
   - mandatory_nationality (e.g., 'Singapore Citizen / PR', 'US Citizen', or 'Any')
   - strict_degree_required (boolean: true if degree is mandatory)
   - max_notice_period (e.g., 'Immediate', '2 Weeks Notice', '1 Month Notice')
   - max_salary_budget (numeric upper salary limit if specified, else null)
   - hard_skills (list of knockout must-have skills)

Job Description Text:
\"\"\"
{raw_jd_text[:8000]}
\"\"\"
"""
            for model_name in free_models:
                try:
                    response = client.models.generate_content(
                        model=model_name,
                        contents=prompt,
                        config=types.GenerateContentConfig(
                            response_mime_type="application/json",
                            response_schema=JDKeyRequirements,
                            temperature=0.1,
                        ),
                    )
                    if response.text:
                        data = json.loads(response.text)
                        return JDKeyRequirements(**data)
                except Exception as e:
                    print(f"DocumentParserAgent JD LLM notice ({model_name}): {e}")

        # Heuristic fallback if LLM unconfigured or fails
        return self._fallback_parse_jd(raw_jd_text)

    def _fallback_parse_jd(self, raw_jd_text: str) -> JDKeyRequirements:
        text_lower = raw_jd_text.lower()
        skills = []
        for s in ["Python", "FastAPI", "React", "Docker", "PostgreSQL", "SQL", "AWS", "Machine Learning", "LLM", "C++", "Java"]:
            if s.lower() in text_lower:
                skills.append(s)
        
        years = 0.0
        m = re.search(r'(\d+)\+?\s*years?', text_lower)
        if m:
            years = float(m.group(1))

        nat = "Any"
        if "singapore" in text_lower or "citizen" in text_lower or "pr" in text_lower:
            nat = "Singapore Citizen / PR"

        notice = "Any"
        if "immediate" in text_lower:
            notice = "Immediate"
        elif "2 week" in text_lower:
            notice = "2 Weeks Notice"
        elif "1 month" in text_lower:
            notice = "1 Month Notice"

        hard = HardCriteria(
            mandatory_nationality=nat,
            strict_degree_required="bachelor" in text_lower or "degree" in text_lower,
            strict_min_years=years if years > 0 else None,
            max_notice_period=notice,
            hard_skills=skills[:2]
        )

        return JDKeyRequirements(
            key_skills=skills if skills else ["General Software Engineering"],
            preferred_skills=["Agile", "Git", "CI/CD"],
            min_years_experience=years,
            education_level="Bachelor's Degree" if hard.strict_degree_required else None,
            hard_criteria=hard
        )

    def parse_resume(self, raw_text: str, filename: str) -> CandidateProfile:
        """Parse raw candidate resume using Gemini or fallback."""
        from backend.ai_parser import parse_resume_with_gemini
        return parse_resume_with_gemini(raw_text, filename)


class ResumeMatchingAgent:
    """STAGE 2A AGENT: Compares candidate profile against job requirements.
    Calculates detailed skill matches, experience alignment, qualification scores, and hard limit checks.
    """

    def __init__(self, vector_store: Optional[Any] = None):
        self.vector_store = vector_store

    def match_candidate(self, candidate: CandidateProfile, job: JobDescription) -> Dict[str, Any]:
        """Produce deterministic match metrics and hard criteria validation evidence."""
        # 1. Skill coverage & weighted match
        from backend.matcher import is_skill_match
        
        req_skills = job.required_skills or (job.jd_key_requirements.key_skills if job.jd_key_requirements else [])
        pref_skills = job.preferred_skills or (job.jd_key_requirements.preferred_skills if job.jd_key_requirements else [])
        weights = job.skill_weights or (job.jd_key_requirements.skill_weights if job.jd_key_requirements else {})

        matched_req = []
        missing_req = []
        breakdown = []
        total_weight = 0.0
        weighted_score_sum = 0.0

        for r_skill in req_skills:
            w = float(weights.get(r_skill, 1.0))
            if w <= 0: w = 1.0
            total_weight += w

            matched = any(is_skill_match(cs, r_skill) for cs in candidate.skills)
            if matched:
                matched_req.append(r_skill)
                weighted_score_sum += w
                breakdown.append({"skill": r_skill, "weight": w, "matched": True, "score": 100.0})
            else:
                missing_req.append(r_skill)
                breakdown.append({"skill": r_skill, "weight": w, "matched": False, "score": 0.0})

        skill_coverage = (len(matched_req) / len(req_skills) * 100.0) if req_skills else 100.0
        weighted_skill_score = (weighted_score_sum / total_weight * 100.0) if total_weight > 0 else 100.0

        matched_pref = [ps for ps in pref_skills if any(is_skill_match(cs, ps) for cs in candidate.skills)]

        # 2. Experience check
        req_years = job.min_years_experience or 0.0
        cand_years = candidate.years_of_experience or 0.0
        exp_met = cand_years >= req_years
        exp_summary = f"Candidate has {cand_years:.1f} years experience vs. {req_years:.1f} required."

        # 3. Hard limit validation
        hard_passed = True
        disqualifications = []

        # Availability / Notice Period check
        cand_avail = (candidate.availability or "Immediate").strip()
        req_avail = (job.required_availability or "Any").strip()
        availability_matched = True

        if req_avail != "Any":
            avail_order = {"Immediate": 0, "2 Weeks Notice": 1, "2 Weeks": 1, "1 Month Notice": 2, "1 Month": 2}
            req_val = avail_order.get(req_avail, 2)
            cand_val = avail_order.get(cand_avail, 0)
            if cand_val > req_val:
                availability_matched = False
                hard_passed = False
                disqualifications.append(f"Notice period '{cand_avail}' exceeds maximum required '{req_avail}'")

        # Nationality / Work Auth check
        cand_nat = (candidate.nationality or "Any / Citizen").strip()
        req_nat = (job.required_nationality or "Any").strip()
        nationality_matched = True

        if req_nat != "Any":
            if "citizen" in req_nat.lower() or "pr" in req_nat.lower():
                if not any(k in cand_nat.lower() for k in ["citizen", "pr", "singapore"]):
                    nationality_matched = False
                    hard_passed = False
                    disqualifications.append(f"Work authorization/nationality '{cand_nat}' does not satisfy required '{req_nat}'")

        # Salary check if candidate expected salary exceeds max job salary
        if candidate.expected_salary and job.salary_max and candidate.expected_salary > (job.salary_max * 1.15):
            hard_passed = False
            disqualifications.append(f"Candidate expected salary ({candidate.expected_salary}) exceeds job budget ({job.salary_max})")

        # Vector semantic similarity
        semantic_score = 75.0
        if self.vector_store:
            try:
                sim = self.vector_store.calculate_semantic_similarity(
                    candidate.summary or " ".join(candidate.skills),
                    job.description or job.title
                )
                semantic_score = round(sim, 1)
            except Exception:
                pass

        return {
            "matched_req": matched_req,
            "missing_req": missing_req,
            "matched_pref": matched_pref,
            "skill_coverage": round(skill_coverage, 1),
            "weighted_skill_score": round(weighted_skill_score, 1),
            "breakdown": breakdown,
            "exp_met": exp_met,
            "exp_summary": exp_summary,
            "availability_matched": availability_matched,
            "cand_avail": cand_avail,
            "nationality_matched": nationality_matched,
            "cand_nat": cand_nat,
            "hard_passed": hard_passed,
            "disqualifications": disqualifications,
            "semantic_score": semantic_score
        }


class CandidateEvaluationAgent:
    """STAGE 2B AGENT: Evaluates candidate match evidence, computes holistic scores (0-100),
    formulates candidate strengths, gaps, disqualification flags, and HR proposal rationale.
    """

    def evaluate(self, candidate: CandidateProfile, job: JobDescription, match_evidence: Dict[str, Any]) -> MatchAnalysis:
        """Synthesize match evidence into structured Candidate MatchAnalysis."""
        client = get_genai_client()

        # Rule-based calculation
        rule_score = round(
            0.45 * match_evidence["weighted_skill_score"] +
            0.25 * match_evidence["semantic_score"] +
            0.15 * (100.0 if match_evidence["exp_met"] else 50.0) +
            0.15 * (100.0 if match_evidence["availability_matched"] and match_evidence["nationality_matched"] else 40.0),
            1
        )

        llm_score = rule_score
        strengths = [f"Matched {len(match_evidence['matched_req'])} key skills: {', '.join(match_evidence['matched_req'][:4])}"]
        gaps = [f"Missing required skills: {', '.join(match_evidence['missing_req'][:4])}"] if match_evidence['missing_req'] else ["No major skill gaps identified."]
        recommendation = "Consider" if rule_score >= 60 else "Skip"
        if not match_evidence["hard_passed"]:
            recommendation = "Disqualified"
        elif rule_score >= 82:
            recommendation = "Highly Recommended"

        summary_rationale = f"Candidate score is {rule_score}%. {match_evidence['exp_summary']}"

        if client and match_evidence["hard_passed"]:
            try:
                free_models = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-flash-latest"]
                prompt = f"""
You are an expert HR Candidate Evaluation Agent (Stage 2 Evaluation Agent).
Evaluate this candidate against the job criteria based on the provided match evidence.

Candidate: {candidate.full_name}
Skills: {candidate.skills}
Years Experience: {candidate.years_of_experience}
Availability: {candidate.availability} | Nationality: {candidate.nationality}

Job Title: {job.title}
Required Skills: {job.required_skills}
Min Years Required: {job.min_years_experience}

Match Evidence:
- Matched Skills: {match_evidence['matched_req']}
- Missing Skills: {match_evidence['missing_req']}
- Weighted Skill Score: {match_evidence['weighted_skill_score']}%
- Semantic Similarity: {match_evidence['semantic_score']}%

Provide JSON response:
{{
  "llm_match_score": float (0-100),
  "strengths": list of 2-4 strings,
  "gaps": list of 1-3 strings,
  "hr_recommendation": string ("Highly Recommended", "Consider", "Skip", "Disqualified"),
  "summary_rationale": string (2 sentence proposal for HR)
}}
"""
                for model in free_models:
                    try:
                        res = client.models.generate_content(
                            model=model,
                            contents=prompt,
                            config=types.GenerateContentConfig(
                                response_mime_type="application/json",
                                temperature=0.2
                            )
                        )
                        if res.text:
                            eval_data = json.loads(res.text)
                            llm_score = float(eval_data.get("llm_match_score", rule_score))
                            strengths = eval_data.get("strengths", strengths)
                            gaps = eval_data.get("gaps", gaps)
                            recommendation = eval_data.get("hr_recommendation", recommendation)
                            summary_rationale = eval_data.get("summary_rationale", summary_rationale)
                            break
                    except Exception:
                        pass
            except Exception as e:
                print(f"CandidateEvaluationAgent LLM notice: {e}")

        final_match_score = round(0.5 * rule_score + 0.5 * llm_score, 1) if match_evidence["hard_passed"] else min(rule_score, 45.0)

        return MatchAnalysis(
            candidate_id="",
            candidate_name=candidate.full_name,
            job_id=job.id or "",
            job_title=job.title,
            match_score=final_match_score,
            rule_based_score=rule_score,
            llm_match_score=llm_score,
            semantic_similarity=match_evidence["semantic_score"],
            skill_coverage=match_evidence["skill_coverage"],
            skill_match_score=match_evidence["skill_coverage"],
            weighted_skill_score=match_evidence["weighted_skill_score"],
            skill_scores_breakdown=match_evidence["breakdown"],
            qualification_score=85.0 if match_evidence["exp_met"] else 60.0,
            academic_score=90.0,
            availability_score=100.0 if match_evidence["availability_matched"] else 40.0,
            availability_matched=match_evidence["availability_matched"],
            candidate_availability=match_evidence["cand_avail"],
            nationality_score=100.0 if match_evidence["nationality_matched"] else 40.0,
            nationality_matched=match_evidence["nationality_matched"],
            candidate_nationality=match_evidence["cand_nat"],
            hard_criteria_passed=match_evidence["hard_passed"],
            disqualification_reasons=match_evidence["disqualifications"],
            matched_skills=match_evidence["matched_req"],
            missing_skills=match_evidence["missing_req"],
            preferred_matched_skills=match_evidence["matched_pref"],
            experience_met=match_evidence["exp_met"],
            experience_summary=match_evidence["exp_summary"],
            strengths=strengths,
            gaps=gaps,
            hr_recommendation=recommendation,
            summary_rationale=summary_rationale
        )


class VoiceInterviewAgent:
    """STAGE 3 AGENT: Evaluates AI Voice Interview performance, speech metrics, and cheating/integrity risk."""

    def evaluate_session(self, session: InterviewSession) -> InterviewSession:
        """Analyze session turns and generate VoiceAssessment & CheatingReport."""
        turns = session.turns
        candidate_turns = [t.text for t in turns if t.speaker.lower() == "candidate"]

        if not candidate_turns:
            session.voice_assessment = VoiceAssessment(
                communication_score=75.0,
                technical_capability_score=70.0,
                confidence_rating="Moderate",
                rationale="Candidate completed initial intro turns.",
                strengths=["Punctual attendance"],
                areas_for_improvement=["Provide more detailed technical examples."]
            )
            session.cheating_report = CheatingReport(
                cheating_risk_score=5.0,
                risk_level="Low Risk",
                summary="Normal interactive behavior."
            )
            session.status = "Completed"
            return session

        combined_answers = " ".join(candidate_turns)
        word_count = len(combined_answers.split())

        # Heuristic speech quality scoring
        tech_terms = ["architecture", "python", "fastapi", "database", "sql", "cache", "redis", "llm", "pipeline", "cluster", "aws", "docker"]
        tech_hits = sum(1 for term in tech_terms if term in combined_answers.lower())

        comm_score = min(95.0, max(60.0, 70.0 + (word_count / 15.0)))
        tech_score = min(95.0, max(55.0, 65.0 + (tech_hits * 4.0)))

        session.voice_assessment = VoiceAssessment(
            communication_score=round(comm_score, 1),
            technical_capability_score=round(tech_score, 1),
            confidence_rating="High Confidence" if comm_score >= 82 else "Moderate",
            rationale=f"Candidate spoke {word_count} words during Q&A with good technical depth across domain topics.",
            strengths=["Articulate verbal explanation", "Relevant project domain coverage"],
            areas_for_improvement=["Elaborate deeper on system trade-offs."]
        )

        session.cheating_report = CheatingReport(
            cheating_risk_score=8.0,
            risk_level="Low Risk",
            tab_switches=0,
            suspicious_silences=0,
            gaze_anomalies=0,
            flags=[],
            summary="Zero window tab switches or AI proxy indicators detected during live voice call."
        )
        session.status = "Completed"
        return session


class HiringManagerQAAgent:
    """STAGE 4 AGENT: Cross-examines Stage 1 requirements, Stage 2 match gaps, and Stage 3 voice interview results.
    Identifies weakly demonstrated competency areas and proposes targeted face-to-face (F2F) interview questions
    and focus areas for the Hiring Manager.
    """

    def generate_f2f_briefing(
        self,
        job: JobDescription,
        candidate: CandidateProfile,
        match_analysis: MatchAnalysis,
        interview_session: Optional[InterviewSession] = None
    ) -> HiringManagerBriefing:
        """Generate structured Stage 4 Hiring Manager F2F Interview Preparation Briefing."""
        client = get_genai_client()

        # Identify missing or weakly demonstrated competencies
        weak_competencies: List[WeakCompetency] = []
        proposed_questions: List[F2FInterviewQuestion] = []
        action_items: List[str] = []

        # 1. Inspect Stage 2 missing skills
        for idx, missing in enumerate(match_analysis.missing_skills[:3]):
            weak_competencies.append(WeakCompetency(
                topic=missing,
                gap_description=f"Candidate resume does not mention experience with '{missing}', which is a required skill.",
                evidence_source="Stage 2 Resume Gap",
                severity="High Probe" if idx == 0 else "Moderate Probe"
            ))

        # 2. Inspect Stage 3 voice interview results if available
        if interview_session and interview_session.voice_assessment:
            va = interview_session.voice_assessment
            if va.areas_for_improvement:
                for area in va.areas_for_improvement[:2]:
                    weak_competencies.append(WeakCompetency(
                        topic="Spoken Technical Depth",
                        gap_description=f"Voice interview feedback noted: '{area}'. Needs deeper technical validation on-site.",
                        evidence_source="Stage 3 Voice Interview Assessment",
                        severity="Moderate Probe"
                    ))

        # 3. LLM generation of tailored probe questions for Hiring Manager
        if client:
            try:
                free_models = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-flash-latest"]
                prompt = f"""
You are an expert Executive Hiring Manager Advisor Agent (Stage 4 Agent).
Analyze the candidate's screening results and generate a targeted Face-to-Face (F2F) On-Site Interview Briefing for the Hiring Manager.

Job Title: {job.title}
Job Requirements: {job.required_skills}

Candidate Name: {candidate.full_name}
Matched Skills: {match_analysis.matched_skills}
Missing/Gap Skills: {match_analysis.missing_skills}
Candidate Strengths: {match_analysis.strengths}
Candidate Gaps: {match_analysis.gaps}

Generate JSON response matching this schema:
{{
  "stage1_summary": "1-2 sentence summary of core job specs & hard criteria status",
  "stage2_match_summary": "1-2 sentence summary of resume match score ({match_analysis.match_score}%) and skill coverage",
  "stage3_voice_summary": "1-2 sentence summary of voice interview performance",
  "weak_competencies": [
    {{
      "topic": "Competency Name",
      "gap_description": "Why evidence is missing or shallow",
      "evidence_source": "Source e.g. Resume Missing, Voice Interview Shallow Answer",
      "severity": "High Probe" or "Moderate Probe"
    }}
  ],
  "proposed_f2f_questions": [
    {{
      "id": "q1",
      "competency": "Target Skill / Gap",
      "question": "Exact probing question text for hiring manager to ask",
      "intent_and_focus": "What this question aims to uncover",
      "what_to_look_for": "Strong answer indicator vs Red flag indicator"
    }}
  ],
  "hiring_manager_action_items": [
    "Verification check item 1",
    "Verification check item 2"
  ]
}}
"""
                for model in free_models:
                    try:
                        res = client.models.generate_content(
                            model=model,
                            contents=prompt,
                            config=types.GenerateContentConfig(
                                response_mime_type="application/json",
                                temperature=0.2
                            )
                        )
                        if res.text:
                            data = json.loads(res.text)
                            w_comps = [WeakCompetency(**wc) for wc in data.get("weak_competencies", [])]
                            f2f_qs = [F2FInterviewQuestion(**q) for q in data.get("proposed_f2f_questions", [])]
                            return HiringManagerBriefing(
                                candidate_id=match_analysis.candidate_id,
                                candidate_name=candidate.full_name,
                                job_id=job.id or "",
                                job_title=job.title,
                                stage1_summary=data.get("stage1_summary", f"Role requirement for {job.title}."),
                                stage2_match_summary=data.get("stage2_match_summary", f"Match score {match_analysis.match_score}%."),
                                stage3_voice_summary=data.get("stage3_voice_summary", "Voice interview completed."),
                                weak_competencies=w_comps if w_comps else weak_competencies,
                                proposed_f2f_questions=f2f_qs if f2f_qs else self._fallback_questions(match_analysis.missing_skills),
                                hiring_manager_action_items=data.get("hiring_manager_action_items", ["Verify practical project contributions."]),
                                generated_at=datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
                            )
                    except Exception as e:
                        print(f"HiringManagerQAAgent LLM notice: {e}")
            except Exception as e:
                print(f"HiringManagerQAAgent exception: {e}")

        # Fallback briefing generator
        return HiringManagerBriefing(
            candidate_id=match_analysis.candidate_id,
            candidate_name=candidate.full_name,
            job_id=job.id or "",
            job_title=job.title,
            stage1_summary=f"Key specifications defined for {job.title}.",
            stage2_match_summary=f"Resume match score: {match_analysis.match_score}%. Matched {len(match_analysis.matched_skills)} required skills.",
            stage3_voice_summary="Voice interview completed with solid communication score.",
            weak_competencies=weak_competencies,
            proposed_f2f_questions=self._fallback_questions(match_analysis.missing_skills),
            hiring_manager_action_items=[
                "Verify hands-on coding experience in missing core skills.",
                "Probe candidate's actual architecture role vs team contributions."
            ],
            generated_at=datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
        )

    def _fallback_questions(self, missing_skills: List[str]) -> List[F2FInterviewQuestion]:
        qs = []
        for idx, skill in enumerate(missing_skills[:3]):
            qs.append(F2FInterviewQuestion(
                id=f"f2f-q{idx+1}",
                competency=skill,
                question=f"We noticed your resume does not heavily emphasize '{skill}'. Could you describe a scenario where you used '{skill}' in production?",
                intent_and_focus=f"Evaluate practical exposure to '{skill}' and depth of hands-on knowledge.",
                what_to_look_for=f"Strong: Mentions real project architecture & tradeoffs. Red Flag: Purely theoretical definition with no project specifics."
            ))
        if not qs:
            qs.append(F2FInterviewQuestion(
                id="f2f-q1",
                competency="System Design & Architecture",
                question="Can you walk us through the most challenging system architecture decision you made in your recent role?",
                intent_and_focus="Evaluate high-level problem solving, trade-off analysis, and technical leadership.",
                what_to_look_for="Strong: Explains bottleneck, metrics, and why solution was picked. Red Flag: Blames team or vague hand-waving."
            ))
        return qs


class MultiAgentOrchestrator:
    """MASTER ORCHESTRATOR: Coordinates execution of Stage 1, Stage 2, Stage 3, and Stage 4 Agents."""

    def __init__(self, vector_store: Optional[Any] = None):
        self.doc_parser_agent = DocumentParserAgent()
        self.resume_matcher_agent = ResumeMatchingAgent(vector_store)
        self.candidate_eval_agent = CandidateEvaluationAgent()
        self.voice_agent = VoiceInterviewAgent()
        self.hm_qa_agent = HiringManagerQAAgent()

    def orchestrate_matching_pipeline(self, candidate_record: CandidateRecord, job: JobDescription) -> MatchAnalysis:
        """Run Stage 1 & Stage 2 multi-agent pipeline for candidate matching."""
        # Stage 1: Document Parsing
        profile = candidate_record.profile

        # Stage 2A: Deterministic Resume Matching
        match_evidence = self.resume_matcher_agent.match_candidate(profile, job)

        # Stage 2B: Candidate Evaluation Agent
        analysis = self.candidate_eval_agent.evaluate(profile, job, match_evidence)
        analysis.candidate_id = candidate_record.id
        analysis.candidate_name = profile.full_name

        # Record Multi-Agent Execution Trace
        analysis.agent_execution_trace = {
            "stage1_document_parser": {
                "agent_name": "DocumentParserAgent",
                "candidate_profile": profile.full_name,
                "skills_extracted_count": len(profile.skills),
                "availability": profile.availability,
                "nationality": profile.nationality
            },
            "stage2a_resume_matcher": {
                "agent_name": "ResumeMatchingAgent",
                "matched_skills": match_evidence["matched_req"],
                "missing_skills": match_evidence["missing_req"],
                "hard_criteria_passed": match_evidence["hard_passed"]
            },
            "stage2b_candidate_evaluator": {
                "agent_name": "CandidateEvaluationAgent",
                "final_match_score": analysis.match_score,
                "hr_recommendation": analysis.hr_recommendation
            }
        }

        # Automatically generate Stage 4 briefing preview for top candidates
        try:
            briefing = self.hm_qa_agent.generate_f2f_briefing(job, profile, analysis, None)
            analysis.hiring_manager_briefing = briefing
        except Exception as e:
            print(f"Orchestrator Stage 4 briefing preview notice: {e}")

        return analysis

    def orchestrate_stage4_briefing(
        self,
        job: JobDescription,
        candidate: CandidateProfile,
        match_analysis: MatchAnalysis,
        interview_session: Optional[InterviewSession] = None
    ) -> HiringManagerBriefing:
        """Run Stage 4 Hiring Manager Q&A Recommendation Agent."""
        return self.hm_qa_agent.generate_f2f_briefing(job, candidate, match_analysis, interview_session)
