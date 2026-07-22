let sampleJobs = [];
let selectedJob = null;
let currentMatchResults = [];
let currentJobMode = "form";
let currentRole = "hr";
let activeCandidate = null; // Stored candidate profile for active job seeker
let userApplications = [];

document.addEventListener("DOMContentLoaded", () => {
  checkApiKeyStatus();
  fetchSampleJobs();
  loadCandidatesList();
  setupDragAndDrop();
  loadSeekerJobs();
});

async function checkApiKeyStatus() {
  const btn = document.getElementById("apiKeyBtn");
  const modalStatus = document.getElementById("apiKeyModalStatus");

  try {
    const res = await fetch("/api/api-key-status");
    const data = await res.json();

    if (data.has_api_key) {
      btn.innerHTML = `🟢 Google AI: Active (${data.masked_key})`;
      btn.style.borderColor = "rgba(16, 185, 129, 0.5)";
      btn.style.color = "#6ee7b7";
      if (modalStatus) modalStatus.innerHTML = `🟢 Active (${data.masked_key})`;
    } else {
      btn.innerHTML = `🔑 Configure Google AI API Key`;
      btn.style.borderColor = "rgba(245, 158, 11, 0.5)";
      btn.style.color = "#fde68a";
      if (modalStatus) modalStatus.innerHTML = `⚠️ Not Configured (Using Rule-based Parser)`;
    }
  } catch (e) {
    if (btn) btn.innerHTML = `🔑 Google AI API Key`;
  }
}

function openApiKeyModal() {
  checkApiKeyStatus();
  document.getElementById("apiKeyModal").classList.add("active");
}

function closeApiKeyModal() {
  document.getElementById("apiKeyModal").classList.remove("active");
}

async function saveApiKey() {
  const keyInput = document.getElementById("userApiKeyInput");
  const key = keyInput.value.trim();
  const modalStatus = document.getElementById("apiKeyModalStatus");

  if (!key) {
    alert("Please enter a valid Google AI Gemini API Key.");
    return;
  }

  modalStatus.innerText = "⏳ Applying API Key...";

  try {
    const res = await fetch("/api/set-api-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: key })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Failed to set API Key");
    }

    alert("✅ Google AI Gemini API Key successfully applied!");
    keyInput.value = "";
    closeApiKeyModal();
    checkApiKeyStatus();
  } catch (err) {
    modalStatus.innerText = `❌ Error: ${err.message}`;
    alert(`❌ Failed to save API Key: ${err.message}`);
  }
}


function switchPortalRole(role) {
  currentRole = role;
  document.getElementById("roleHrBtn").classList.toggle("active", role === 'hr');
  document.getElementById("roleSeekerBtn").classList.toggle("active", role === 'seeker');

  document.getElementById("hrPortalView").classList.toggle("active", role === 'hr');
  document.getElementById("seekerPortalView").classList.toggle("active", role === 'seeker');

  if (role === 'seeker') {
    loadSeekerJobs();
    loadSeekerApplications();
  } else {
    fetchSampleJobs();
    loadCandidatesList();
  }
}

function switchHrTab(tabId, btnElement) {
  document.querySelectorAll("#hrPortalView .tab-content").forEach(el => el.classList.remove("active"));
  document.querySelectorAll("#hrPortalView .nav-btn").forEach(el => el.classList.remove("active"));
  
  document.getElementById(tabId).classList.add("active");
  if (btnElement) btnElement.classList.add("active");

  if (tabId === "hrRepositoryTab") {
    loadCandidatesList();
  } else if (tabId === "hrApplicantsTab") {
    fetchSampleJobs().then(() => {
      const select = document.getElementById("jobSelect");
      if (select && select.options.length > 1) {
        if (!select.value) {
          select.selectedIndex = 1;
        }
        // Automatically trigger evaluation if no analytics cached for target job
        if (!currentMatchResults || currentMatchResults.length === 0) {
          loadSelectedJobApplicants();
        }
      }
    });
  }
}


function switchSeekerTab(tabId, btnElement) {
  document.querySelectorAll("#seekerPortalView .tab-content").forEach(el => el.classList.remove("active"));
  document.querySelectorAll("#seekerPortalView .nav-btn").forEach(el => el.classList.remove("active"));
  
  document.getElementById(tabId).classList.add("active");
  if (btnElement) btnElement.classList.add("active");

  if (tabId === "seekerJobsTab") {
    loadSeekerJobs();
  } else if (tabId === "seekerAppsTab") {
    loadSeekerApplications();
  }
}

function switchJobMode(mode) {
  currentJobMode = mode;
  document.getElementById("modeFormBtn").classList.toggle("active", mode === 'form');
  document.getElementById("modeAiBtn").classList.toggle("active", mode === 'ai');

  document.getElementById("modeFormContainer").style.display = mode === 'form' ? "block" : "none";
  document.getElementById("modeAiContainer").style.display = mode === 'ai' ? "block" : "none";
}

function generateSkillWeightSliders() {
  const reqStr = document.getElementById("customJdReqSkills").value.trim();
  const container = document.getElementById("skillWeightBuilderList");
  if (!reqStr) {
    container.innerHTML = `<p style="font-size: 0.85rem; color: var(--text-muted);">Enter required skills above and click "Generate Weights" to customize individual skill importance.</p>`;
    return;
  }

  const skills = reqStr.split(",").map(s => s.trim()).filter(s => s);
  if (skills.length === 0) return;

  const defaultWeight = Math.round(100 / skills.length);

  container.innerHTML = skills.map((skill, idx) => `
    <div class="skill-weight-item">
      <span class="skill-weight-name">🎯 ${skill}</span>
      <input type="range" class="weight-slider" id="weightSlider_${idx}" min="10" max="100" step="5" value="${defaultWeight}" oninput="document.getElementById('weightVal_${idx}').innerText = this.value + '%'">
      <span id="weightVal_${idx}" class="skill-weight-val" style="color:var(--accent-cyan); font-weight:700; font-size:0.85rem;">${defaultWeight}%</span>
    </div>
  `).join("");
}

function getSkillWeightsPayload() {
  const reqStr = document.getElementById("customJdReqSkills").value.trim();
  const skills = reqStr.split(",").map(s => s.trim()).filter(s => s);
  const weights = {};

  skills.forEach((skill, idx) => {
    const slider = document.getElementById(`weightSlider_${idx}`);
    weights[skill] = slider ? parseFloat(slider.value) : (100.0 / skills.length);
  });

  return weights;
}

function setupDragAndDrop() {
  const dropzone = document.getElementById("dropzone");
  if (!dropzone) return;

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, preventDefaults, false);
  });

  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, () => dropzone.classList.add('dragover'), false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, () => dropzone.classList.remove('dragover'), false);
  });

  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      uploadFile(files[0]);
    }
  });
}

function handleFileSelect(event) {
  const files = event.target.files;
  if (files.length > 0) {
    uploadFile(files[0]);
  }
}

async function uploadFile(file) {
  const statusDiv = document.getElementById("uploadStatus");
  statusDiv.style.display = "block";
  statusDiv.style.color = "#a5b4fc";
  statusDiv.innerHTML = "⏳ Uploading & parsing resume text with Google AI...";

  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await fetch("/api/upload-resume", {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || "Upload failed");
    }

    const candidateRecord = await response.json();
    activeCandidate = candidateRecord;

    statusDiv.style.color = "#6ee7b7";
    statusDiv.innerHTML = `✅ Candidate Profile created for <strong>${candidateRecord.profile.full_name}</strong>! You can now browse & apply for jobs.`;

    renderParsedPreview(candidateRecord.profile);
    loadCandidatesList();
  } catch (error) {
    statusDiv.style.color = "#fca5a5";
    statusDiv.innerHTML = `❌ Error: ${error.message}`;
  }
}

function renderParsedPreview(profile) {
  const container = document.getElementById("parsedProfileContainer");
  
  const skillsHtml = profile.skills && profile.skills.length > 0
    ? profile.skills.map(s => `<span class="skill-pill">${s}</span>`).join("")
    : "<span style='color:var(--text-muted)'>No explicit skills extracted</span>";

  const expHtml = profile.experience && profile.experience.length > 0
    ? profile.experience.map(e => `
        <div style="margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px dashed rgba(255,255,255,0.1);">
          <strong style="color:#fff;">${e.title || 'Role'}</strong> at <span style="color:#a5b4fc;">${e.company || 'Company'}</span> (${e.duration || 'N/A'})
          <p style="font-size:0.85rem; color:var(--text-muted); margin-top:2px;">${e.description || ''}</p>
        </div>
      `).join("")
    : "<p style='font-size:0.85rem;'>None listed</p>";

  container.innerHTML = `
    <div style="text-align: left;">
      <h3 style="color:#fff; font-size:1.3rem; margin-bottom:4px;">${profile.full_name}</h3>
      <p style="color:var(--accent-cyan); font-size:0.9rem; margin-bottom:12px;">
        📧 ${profile.email || 'N/A'} | 📞 ${profile.phone || 'N/A'} | ⏳ ${profile.years_of_experience || 0} Yrs Exp | ⚡ ${profile.availability || 'Immediate'}
      </p>
      <div style="margin-bottom: 8px; font-size:0.85rem; color:var(--accent-emerald);">
        🛂 Nationality / Work Authorization: <strong>${profile.nationality || 'Any / Citizen'}</strong>
      </div>
      
      <div style="margin-bottom: 16px;">
        <strong style="color:#fff; font-size:0.9rem;">Summary:</strong>
        <p style="font-size:0.88rem; color:var(--text-sub); margin-top:4px;">${profile.summary || 'N/A'}</p>
      </div>

      <div style="margin-bottom: 16px;">
        <strong style="color:#fff; font-size:0.9rem;">Key Extracted Skills:</strong>
        <div class="skills-list">${skillsHtml}</div>
      </div>

      <div>
        <strong style="color:#fff; font-size:0.9rem;">Work Experience:</strong>
        <div style="margin-top:8px;">${expHtml}</div>
      </div>
    </div>
  `;
}

async function fetchSampleJobs() {
  try {
    const res = await fetch("/api/sample-jobs");
    sampleJobs = await res.json();

    const select = document.getElementById("jobSelect");
    select.innerHTML = `<option value="">-- Select Target Job Opening --</option>` +
      sampleJobs.map(j => {
        const salStr = (j.salary_min && j.salary_max) ? ` (${j.salary_currency || '$'}${j.salary_min.toLocaleString()} - ${j.salary_currency || '$'}${j.salary_max.toLocaleString()})` : '';
        return `<option value="${j.id}">${j.title}${salStr}</option>`;
      }).join("");
  } catch (err) {
    console.error("Failed to fetch sample jobs:", err);
  }
}

async function triggerBatchProcess() {
  const category = document.getElementById("batchCategorySelect").value;
  const maxCount = parseInt(document.getElementById("batchMaxCount").value) || 15;
  const msgDiv = document.getElementById("batchStatusMessage");

  msgDiv.style.color = "#a5b4fc";
  msgDiv.innerText = `⏳ Batch processing PDF resumes from resumes/data/data/${category} using Google AI model...`;

  try {
    const res = await fetch("/api/batch-process-resumes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: category, max_resumes: maxCount })
    });

    if (!res.ok) throw new Error("Batch processing failed");

    const data = await res.json();
    msgDiv.style.color = "#6ee7b7";
    msgDiv.innerText = `✅ Processed ${data.processed_count} new candidate resumes! Total indexed in database: ${data.total_store_candidates}.`;

    await loadCandidatesList();
    if (selectedJob) {
      loadSelectedJobApplicants();
    }
  } catch (err) {
    msgDiv.style.color = "#fca5a5";
    msgDiv.innerText = `❌ Error batch processing resumes: ${err.message}`;
  }
}

async function extractJdWithAi() {
  const rawText = document.getElementById("rawJdInput").value;
  if (!rawText || !rawText.trim()) {
    alert("Please paste raw job description text first.");
    return;
  }

  const status = document.getElementById("aiJdStatus");
  status.innerHTML = "⏳ Google AI extracting job requirements, skill weights, salary range, and target candidate count...";

  try {
    const res = await fetch("/api/jobs/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw_text: rawText.trim() })
    });

    if (!res.ok) throw new Error("Job parsing failed");

    const parsedJob = await res.json();

    const saveRes = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsedJob)
    });
    selectedJob = await saveRes.json();
    await fetchSampleJobs();

    status.innerHTML = `✅ Published Job Opening: <strong>${selectedJob.title}</strong>!`;

    currentMatchResults = [];
    switchHrTab('hrApplicantsTab', document.querySelectorAll("#hrPortalView .nav-btn")[1]);
    document.getElementById("jobSelect").value = selectedJob.id;
    loadSelectedJobApplicants();


  } catch (err) {
    status.innerHTML = `❌ Error: ${err.message}`;
  }
}

async function submitCustomJobAndMatch() {
  const title = document.getElementById("customJdTitle").value.trim();
  const reqSkillsStr = document.getElementById("customJdReqSkills").value.trim();
  
  if (!title || !reqSkillsStr) {
    alert("Please fill in Job Title and Required Skills.");
    return;
  }

  const dept = document.getElementById("customJdDept").value.trim() || "Engineering";
  const salMin = parseFloat(document.getElementById("customJdSalMin").value) || 100000;
  const salMax = parseFloat(document.getElementById("customJdSalMax").value) || 150000;
  const targetCount = parseInt(document.getElementById("customJdTargetCount").value) || 3;
  const minExp = parseFloat(document.getElementById("customJdMinExp").value) || 0.0;
  const edu = document.getElementById("customJdEdu").value;
  const avail = document.getElementById("customJdAvail").value;
  const nat = document.getElementById("customJdNat").value;
  const prefSkillsStr = document.getElementById("customJdPrefSkills").value.trim();
  const desc = document.getElementById("customJdDesc").value.trim() || `${title} opening in ${dept}.`;

  const reqSkills = reqSkillsStr.split(",").map(s => s.trim()).filter(s => s);
  const prefSkills = prefSkillsStr ? prefSkillsStr.split(",").map(s => s.trim()).filter(s => s) : [];
  const skillWeights = getSkillWeightsPayload();

  const customJobPayload = {
    title: title,
    department: dept,
    required_skills: reqSkills,
    preferred_skills: prefSkills,
    skill_weights: skillWeights,
    min_years_experience: minExp,
    salary_min: salMin,
    salary_max: salMax,
    salary_currency: "$",
    target_candidate_count: targetCount,
    education_level: edu,
    required_availability: avail,
    required_nationality: nat,
    description: desc
  };

  try {
    const saveRes = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(customJobPayload)
    });

    if (!saveRes.ok) throw new Error("Failed to save custom job");

    selectedJob = await saveRes.json();
    await fetchSampleJobs();

    alert(`✅ Successfully published Job Opening: "${selectedJob.title}" with custom skill weights (Targeting Top ${targetCount} Candidates for Interview)`);

    currentMatchResults = [];
    switchHrTab('hrApplicantsTab', document.querySelectorAll("#hrPortalView .nav-btn")[1]);
    document.getElementById("jobSelect").value = selectedJob.id;
    loadSelectedJobApplicants();

  } catch (err) {
    alert(`Error creating job: ${err.message}`);
  }
}

async function autoExtractJobDetailsWithLLM() {
  const title = document.getElementById("customJdTitle").value.trim() || "Target Job Position";
  const dept = document.getElementById("customJdDept") ? document.getElementById("customJdDept").value.trim() : "Engineering";
  const desc = document.getElementById("customJdDesc") ? document.getElementById("customJdDesc").value.trim() : "";
  const targetCount = parseInt(document.getElementById("customJdTargetCount").value) || 3;
  const salMin = parseFloat(document.getElementById("customJdSalMin").value) || 120000;
  const salMax = parseFloat(document.getElementById("customJdSalMax").value) || 160000;
  const statusSpan = document.getElementById("aiPublishStatus");

  if (!desc.trim()) {
    alert("Please paste or type the full Job Description text first.");
    return;
  }

  const rawText = `Position Title: ${title}\nDepartment: ${dept}\n\n${desc}`;

  if (statusSpan) statusSpan.innerText = "⏳ Google AI extracting key skills, qualifications, experience, and scoring candidates...";

  try {
    const res = await fetch("/api/jobs/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw_text: rawText })
    });

    if (!res.ok) throw new Error("LLM Job extraction failed");

    const parsedJob = await res.json();
    if (title && title !== "Target Job Position") parsedJob.title = title;
    if (dept) parsedJob.department = dept;
    parsedJob.target_candidate_count = targetCount;
    parsedJob.salary_min = salMin;
    parsedJob.salary_max = salMax;

    // Save job into database
    const saveRes = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsedJob)
    });

    selectedJob = await saveRes.json();
    await fetchSampleJobs();

    if (statusSpan) statusSpan.innerText = `✅ Extracted ${selectedJob.required_skills.length} skills & scoring candidates!`;

    alert(`✅ Google AI LLM successfully extracted job criteria for "${selectedJob.title}"!\n• Extracted Key Skills: ${selectedJob.required_skills.join(', ')}\n• Required Experience: ${selectedJob.min_years_experience} Yrs\n• Qualification Level: ${selectedJob.education_level}\n\nNavigating to HR Analytics & Leaderboard to score candidate resumes!`);

    currentMatchResults = [];
    switchHrTab('hrApplicantsTab', document.querySelectorAll("#hrPortalView .nav-btn")[1]);
    document.getElementById("jobSelect").value = selectedJob.id;
    loadSelectedJobApplicants();


  } catch (err) {
    if (statusSpan) statusSpan.innerText = `❌ Error: ${err.message}`;
    alert(`❌ LLM Extraction Error: ${err.message}`);
  }
}



async function loadSelectedJobApplicants() {
  const jobId = document.getElementById("jobSelect").value;
  selectedJob = sampleJobs.find(j => j.id === jobId);

  const card = document.getElementById("jobDetailsCard");
  const container = document.getElementById("leaderboardContainer");
  const kpiContainer = document.getElementById("analyticsKpiContainer");
  const visualPanel = document.getElementById("visualAnalyticsPanel");

  if (!selectedJob) {
    card.style.display = "none";
    kpiContainer.style.display = "none";
    visualPanel.style.display = "none";
    container.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 30px;">Select a Job Position above to evaluate applicants.</p>`;
    return;
  }

  card.style.display = "block";
  document.getElementById("jdTitle").innerText = selectedJob.title;
  document.getElementById("jdDesc").innerText = selectedJob.description;
  document.getElementById("jdSkillsList").innerText = (selectedJob.required_skills || []).join(", ");
  document.getElementById("jdTargetCountBadge").innerText = `${selectedJob.target_candidate_count || 3} Candidates`;
  document.getElementById("jdAvailBadge").innerText = selectedJob.required_availability || "Any";
  document.getElementById("jdNatBadge").innerText = selectedJob.required_nationality || "Any";

  const salMin = selectedJob.salary_min ? `$${selectedJob.salary_min.toLocaleString()}` : '';
  const salMax = selectedJob.salary_max ? `$${selectedJob.salary_max.toLocaleString()}` : '';
  document.getElementById("jdSalaryBadge").innerText = (salMin && salMax) ? `💵 Salary: ${salMin} - ${salMax} / yr` : '💵 Competitive Salary';

  container.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 20px;">⚡ Google AI model & weighted skill engine ranking applicants...</p>`;

  try {
    const res = await fetch(`/api/jobs/${selectedJob.id}/ranked-applicants`);
    if (!res.ok) throw new Error("Failed to fetch ranked applicants");

    currentMatchResults = await res.json();
    
    if (!currentMatchResults || currentMatchResults.length === 0) {
      const fallbackRes = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selectedJob)
      });
      if (fallbackRes.ok) {
        currentMatchResults = await fallbackRes.json();
      }
    }

    renderAnalyticsDashboard(currentMatchResults);
    renderLeaderboard(currentMatchResults);
  } catch (err) {
    container.innerHTML = `<p style="color: #fca5a5; text-align: center;">❌ Error evaluating applicants: ${err.message}</p>`;
  }
}

function renderAnalyticsDashboard(matches) {
  const kpiContainer = document.getElementById("analyticsKpiContainer");
  const visualPanel = document.getElementById("visualAnalyticsPanel");
  const chartContainer = document.getElementById("chartContainer");

  if (!matches || matches.length === 0) {
    kpiContainer.style.display = "none";
    visualPanel.style.display = "none";
    return;
  }

  kpiContainer.style.display = "grid";
  visualPanel.style.display = "block";

  const totalApps = matches.length;
  const targetX = selectedJob.target_candidate_count || 3;
  const shortlisted = matches.filter(m => m.selection_status === "Shortlisted for Interview" || m.selection_status === "Selected").length;
  
  const topMatches = matches.slice(0, targetX);
  const avgTopScore = topMatches.length > 0
    ? Math.round(topMatches.reduce((acc, m) => acc + m.match_score, 0) / topMatches.length)
    : 0;

  const avgSkillIndex = Math.round(matches.reduce((acc, m) => acc + (m.weighted_skill_score || m.skill_coverage), 0) / totalApps);

  document.getElementById("kpiTotalApps").innerText = totalApps;
  document.getElementById("kpiTargetCount").innerText = targetX;
  document.getElementById("kpiShortlisted").innerText = shortlisted;
  document.getElementById("kpiAvgTopScore").innerText = `${avgTopScore}%`;
  document.getElementById("kpiSkillIndex").innerText = `${avgSkillIndex}%`;

  // Render Skill Score Comparison Bar Chart for Top Candidates
  const reqSkills = selectedJob.required_skills || [];
  chartContainer.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:12px;">
      ${topMatches.map(m => `
        <div style="background: rgba(15,23,42,0.6); padding:12px 16px; border-radius:8px; border:1px solid var(--border-color);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <strong style="color:#fff; font-size:0.95rem;">Rank #${m.rank_position}: ${m.candidate_name}</strong>
            <span style="color:var(--accent-emerald); font-weight:700; font-size:0.9rem;">Overall Fit: ${m.match_score}% | Weighted Skill: ${m.weighted_skill_score}%</span>
          </div>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width: ${m.match_score}%;"></div>
          </div>
          <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:8px;">
            ${(m.skill_scores_breakdown || []).map(sb => `
              <span style="font-size:0.78rem; padding:2px 8px; border-radius:10px; background:${sb.matched ? 'rgba(16,185,129,0.15)' : 'rgba(244,63,94,0.15)'}; color:${sb.matched ? '#6ee7b7' : '#fca5a5'}; border:1px solid ${sb.matched ? 'rgba(16,185,129,0.3)' : 'rgba(244,63,94,0.3)'}">
                ${sb.skill} (w:${sb.weight}%): ${sb.matched ? '100%' : '0%'}
              </span>
            `).join("")}
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderLeaderboard(matches) {
  const container = document.getElementById("leaderboardContainer");
  if (!matches || matches.length === 0) {
    container.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 30px;">No applicants found for this job position yet.</p>`;
    return;
  }

  container.innerHTML = matches.map((m, index) => {
    let scoreClass = "score-low";
    if (m.match_score >= 75) scoreClass = "score-high";
    else if (m.match_score >= 50) scoreClass = "score-medium";

    const matchedPills = (m.matched_skills || []).map(s => `<span class="skill-pill matched">✓ ${s}</span>`).join("");
    const prefPills = (m.preferred_matched_skills || []).map(s => `<span class="skill-pill preferred">★ ${s}</span>`).join("");
    const missingPills = (m.missing_skills || []).map(s => `<span class="skill-pill missing">✗ ${s}</span>`).join("");

    const expBadgeClass = m.experience_met ? "success" : "warning";
    const expIcon = m.experience_met ? "✓" : "⚠️";

    const isTopChoice = m.is_top_candidate;
    const topBadge = isTopChoice
      ? `<span class="top-candidate-badge">⭐ TOP ${m.rank_position} OF ${selectedJob.target_candidate_count || 3} INTERVIEW SHORTLIST</span>`
      : '';

    let statusClass = "applied";
    if (m.selection_status === "Shortlisted for Interview") statusClass = "shortlisted";
    else if (m.selection_status === "Selected") statusClass = "selected";
    else if (m.selection_status === "Rejected") statusClass = "rejected";

    return `
      <div class="candidate-card ${isTopChoice ? 'top-choice' : ''}">
        <div style="display:flex; align-items:center; gap: 16px; flex: 1;">
          <div style="font-size:1.2rem; font-weight:800; color:var(--text-muted); width:28px;">#${index + 1}</div>
          <div class="candidate-info" style="flex:1;">
            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
              <h3>${m.candidate_name}</h3>
              ${topBadge}
              <span class="status-badge ${statusClass}">${m.selection_status || 'Applied'}</span>
              <span class="badge-qual ${expBadgeClass}">${expIcon} ${m.experience_summary || 'Experience'}</span>
            </div>
            <div class="candidate-sub" style="margin-top:4px;">
              Weighted Skill Score: <strong style="color:#6ee7b7;">${m.weighted_skill_score || m.skill_coverage}%</strong> | Avail: <strong>${m.candidate_availability || 'Immediate'}</strong> | Status: <strong>${m.candidate_nationality || 'Any'}</strong>
            </div>
            <div class="skills-list" style="margin-top:6px;">
              ${matchedPills} ${prefPills} ${missingPills}
            </div>
          </div>
        </div>

        <div style="display:flex; align-items:center; gap: 14px;">
          <div class="score-badge ${scoreClass}">
            ${Math.round(m.match_score)}%
            <span class="score-label">MATCH</span>
          </div>
          <div style="display:flex; flex-direction:column; gap:6px;">
            <button class="btn-primary" onclick="openHRProposalModal('${m.candidate_id}')" style="font-size:0.82rem; padding:6px 14px;">
              🔍 Analysis Rationale
            </button>
            <button class="btn-secondary" onclick="shortlistCandidate('${m.candidate_id}')" style="font-size:0.8rem; padding:4px 10px; background:rgba(245,158,11,0.15); color:#fde68a; border-color:rgba(245,158,11,0.3);">
              ⭐ Shortlist Candidate
            </button>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

async function shortlistCandidate(candidateId) {
  try {
    const res = await fetch(`/api/applications/${candidateId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "Shortlisted for Interview" })
    });

    if (!res.ok) throw new Error("Failed to update status");

    alert(`⭐ Candidate shortlisted for interview!`);
    loadSelectedJobApplicants();
    closeModal();
  } catch (err) {
    alert(`Status update: ${err.message}`);
  }
}

function openHRProposalModal(candidateId) {
  const match = currentMatchResults.find(m => m.candidate_id === candidateId);
  if (!match) return;

  document.getElementById("modalCandidateName").innerText = `HR Proposal & Analytics for ${match.candidate_name}`;
  document.getElementById("modalJobTitle").innerText = `Target Role: ${match.job_title} | Rank #${match.rank_position} | Overall Score: ${match.match_score}%`;
  document.getElementById("modalRationale").innerText = match.summary_rationale;

  const banner = document.getElementById("modalRecBanner");
  const recText = document.getElementById("modalRecText");

  banner.className = "rec-banner";
  if (match.is_top_candidate) {
    banner.classList.add("highly-recommended");
    recText.innerText = `⭐ TOP ${match.rank_position} CANDIDATE FOR INTERVIEW - ${match.hr_recommendation}`;
  } else if (match.match_score >= 50) {
    banner.classList.add("consider");
    recText.innerText = `👍 ${match.hr_recommendation}`;
  } else {
    banner.classList.add("skip");
    recText.innerText = `⚠️ ${match.hr_recommendation}`;
  }

  const qualBadge = document.getElementById("modalQualBadge");
  if (match.experience_met) {
    qualBadge.className = "badge-qual success";
    qualBadge.innerText = `✓ Experience: ${match.experience_summary}`;
  } else {
    qualBadge.className = "badge-qual warning";
    qualBadge.innerText = `⚠️ Experience Gap: ${match.experience_summary}`;
  }

  const skillBadge = document.getElementById("modalSkillScoreBadge");
  skillBadge.className = match.weighted_skill_score >= 60 ? "badge-qual success" : "badge-qual warning";
  skillBadge.innerText = `Weighted Skill Score: ${match.weighted_skill_score || match.skill_coverage}%`;

  const availBadge = document.getElementById("modalAvailBadge");
  availBadge.innerText = `Availability: ${match.candidate_availability || 'Immediate'}`;

  const natBadge = document.getElementById("modalNatBadge");
  natBadge.innerText = `Status: ${match.candidate_nationality || 'Any'}`;

  // Populate Per-Skill Breakdown Table
  const breakdownBody = document.getElementById("modalSkillBreakdownBody");
  if (match.skill_scores_breakdown && match.skill_scores_breakdown.length > 0) {
    breakdownBody.innerHTML = match.skill_scores_breakdown.map(sb => `
      <tr>
        <td><strong>${sb.skill}</strong></td>
        <td>${sb.weight}%</td>
        <td>${sb.matched ? '<span style="color:#6ee7b7; font-weight:700;">✓ Matched</span>' : '<span style="color:#fca5a5;">✗ Missing</span>'}</td>
        <td><strong style="color:${sb.matched ? '#6ee7b7' : '#fca5a5'};">${sb.score}%</strong></td>
      </tr>
    `).join("");
  } else {
    breakdownBody.innerHTML = `<tr><td colspan="4" style="color:var(--text-muted);">No detailed breakdown available</td></tr>`;
  }

  document.getElementById("modalStrengths").innerHTML = (match.strengths || []).map(s => `<li>${s}</li>`).join("");
  document.getElementById("modalGaps").innerHTML = (match.gaps || []).map(g => `<li>${g}</li>`).join("");

  const btn = document.getElementById("modalShortlistBtn");
  btn.onclick = () => shortlistCandidate(match.candidate_id);

  document.getElementById("hrModal").classList.add("active");
}

function closeModal() {
  document.getElementById("hrModal").classList.remove("active");
}

async function loadCandidatesList() {
  const container = document.getElementById("candidatesListTable");
  try {
    const res = await fetch("/api/candidates");
    const candidates = await res.json();

    if (!candidates || candidates.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:30px;">
          <p style="color:var(--text-muted); margin-bottom:12px;">No candidates in database yet.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="margin-bottom: 12px; font-weight:600; color:var(--accent-cyan);">Total Stored Candidates: ${candidates.length}</div>
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap:16px;">
        ${candidates.map(c => `
          <div style="background:rgba(15, 23, 42, 0.6); padding:16px; border-radius:10px; border:1px solid var(--border-color);">
            <h4 style="color:#fff; font-size:1.05rem;">${c.profile.full_name}</h4>
            <div style="font-size:0.82rem; color:var(--text-muted); margin:4px 0;">${c.file_name} (${c.profile.years_of_experience || 0} Yrs Exp)</div>
            <div style="font-size:0.85rem; color:var(--text-sub); margin-top:4px;">
              Avail: <strong>${c.profile.availability || 'Immediate'}</strong> | Status: <strong>${c.profile.nationality || 'Any'}</strong>
            </div>
            <div style="font-size:0.85rem; color:var(--text-sub); margin-top:8px;">
              <strong>Skills:</strong> ${(c.profile.skills || []).slice(0, 6).join(", ")}
            </div>
            <button class="btn-secondary" style="margin-top:10px; font-size:0.78rem; padding:4px 10px;" onclick="selectCandidateAsActive('${c.id}')">Use Profile as Job Seeker</button>
          </div>
        `).join("")}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<p style="color:#fca5a5;">Failed to load candidate list: ${err.message}</p>`;
  }
}

async function selectCandidateAsActive(candidateId) {
  try {
    const res = await fetch(`/api/candidates/${candidateId}`);
    activeCandidate = await res.json();
    alert(`Switched active Job Seeker profile to ${activeCandidate.profile.full_name}`);
    renderParsedPreview(activeCandidate.profile);
    switchPortalRole('seeker');
  } catch (e) {
    alert("Failed to set candidate active profile");
  }
}

/* ==================== JOB SEEKER LOGIC ==================== */

async function loadSeekerJobs() {
  const container = document.getElementById("seekerJobsContainer");
  try {
    const res = await fetch("/api/sample-jobs");
    const jobs = await res.json();

    const appsRes = await fetch("/api/applications");
    userApplications = appsRes.ok ? await appsRes.json() : [];

    if (!jobs || jobs.length === 0) {
      container.innerHTML = `<p style="color:var(--text-muted);">No open jobs available at the moment.</p>`;
      return;
    }

    container.innerHTML = jobs.map(j => {
      const salMin = j.salary_min ? `$${j.salary_min.toLocaleString()}` : '';
      const salMax = j.salary_max ? `$${j.salary_max.toLocaleString()}` : '';
      const salaryStr = (salMin && salMax) ? `${salMin} - ${salMax} / yr` : 'Competitive Salary';
      const skillsPills = (j.required_skills || []).map(s => `<span class="skill-pill">${s}</span>`).join("");

      const candId = activeCandidate ? activeCandidate.id : 'cand-001';
      const hasApplied = userApplications.some(a => a.job_id === j.id && a.candidate_id === candId);

      return `
        <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; display:flex; flex-direction:column; justify-content:space-between;">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:8px;">
              <h3 style="color:#fff; font-size:1.15rem;">${j.title}</h3>
              <span class="salary-badge">💵 ${salaryStr}</span>
            </div>
            <p style="font-size:0.85rem; color:var(--accent-cyan); margin-bottom:10px;">
              🏢 ${j.department || 'General'} | ⏳ Min ${j.min_years_experience || 0} Yrs Exp | 🎓 ${j.education_level || "Bachelor's"}
            </p>
            <div style="font-size:0.82rem; color:var(--text-sub); margin-bottom:10px;">
              ⚡ Desired Availability: <strong>${j.required_availability || 'Any'}</strong> | 🛂 Status: <strong>${j.required_nationality || 'Any'}</strong>
            </div>
            <p style="font-size:0.88rem; color:var(--text-sub); margin-bottom:12px; line-height:1.4;">
              ${(j.description || '').substring(0, 140)}...
            </p>
            <div style="margin-bottom:16px;">
              <strong style="font-size:0.82rem; color:#fff;">Required Skills:</strong>
              <div class="skills-list" style="margin-top:4px;">${skillsPills}</div>
            </div>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; pt-12; border-top: 1px solid var(--border-color);">
            <span style="font-size:0.8rem; color:var(--text-muted);">Target Top Candidates: <strong>${j.target_candidate_count || 3}</strong></span>
            ${hasApplied
              ? `<button class="btn-secondary" disabled style="color:#6ee7b7; border-color:rgba(16,185,129,0.3);">✓ Applied</button>`
              : `<button class="btn-primary" onclick="applyForJob('${j.id}')">⚡ Apply Now</button>`
            }
          </div>
        </div>
      `;
    }).join("");
  } catch (err) {
    container.innerHTML = `<p style="color:#fca5a5;">Failed to load job postings: ${err.message}</p>`;
  }
}

async function applyForJob(jobId) {
  const candidateId = activeCandidate ? activeCandidate.id : 'cand-001';
  const candidateAvail = activeCandidate ? (activeCandidate.profile.availability || "Immediate") : "Immediate";
  const candidateNat = activeCandidate ? (activeCandidate.profile.nationality || "Any / Citizen") : "Any / Citizen";

  try {
    const res = await fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: jobId,
        candidate_id: candidateId,
        candidate_availability: candidateAvail,
        candidate_nationality: candidateNat
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Application failed");
    }

    const appRecord = await res.json();
    alert(`🎉 Application successfully submitted! Application ID: ${appRecord.id}`);
    loadSeekerJobs();
    loadSeekerApplications();
  } catch (err) {
    alert(`❌ Application Error: ${err.message}`);
  }
}

async function loadSeekerApplications() {
  const container = document.getElementById("seekerAppsContainer");
  const candidateId = activeCandidate ? activeCandidate.id : 'cand-001';

  try {
    const res = await fetch(`/api/applications?candidate_id=${candidateId}`);
    const apps = await res.json();

    if (!apps || apps.length === 0) {
      container.innerHTML = `<p style="color:var(--text-muted); text-align:center; padding:20px;">You haven't submitted any job applications yet. Go to <strong>Browse & Apply for Jobs</strong> tab!</p>`;
      return;
    }

    const jobsRes = await fetch("/api/sample-jobs");
    const jobs = jobsRes.ok ? await jobsRes.json() : [];

    container.innerHTML = `
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap:16px;">
        ${apps.map(a => {
          const job = jobs.find(j => j.id === a.job_id);
          const jobTitle = job ? job.title : a.job_id;
          const salaryStr = job && job.salary_min ? `$${job.salary_min.toLocaleString()} - $${job.salary_max.toLocaleString()}` : 'Competitive';

          let statusClass = "applied";
          if (a.status === "Shortlisted for Interview") statusClass = "shortlisted";
          else if (a.status === "Selected") statusClass = "selected";

          return `
            <div style="background:rgba(15, 23, 42, 0.7); border:1px solid var(--border-color); border-radius:10px; padding:16px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <h4 style="color:#fff; font-size:1.05rem;">${jobTitle}</h4>
                <span class="status-badge ${statusClass}">${a.status}</span>
              </div>
              <p style="font-size:0.85rem; color:var(--accent-cyan);">Salary Range: ${salaryStr}</p>
              <p style="font-size:0.8rem; color:var(--text-muted); margin-top:6px;">Applied on: ${new Date(a.applied_at).toLocaleDateString()}</p>
            </div>
          `;
        }).join("")}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<p style="color:#fca5a5;">Failed to load applications: ${err.message}</p>`;
  }
}
