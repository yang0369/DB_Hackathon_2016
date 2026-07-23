import os
import json
import hashlib
import threading
from typing import Optional, Dict, Any
from backend.models import CandidateProfile, JobDescription

CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "cache_store")

class CacheManager:
    """Thread-safe persistent cache engine storing parsed LLM outputs (Job Descriptions, Resumes, and HR Evaluations)."""
    
    def __init__(self, cache_dir: str = CACHE_DIR):
        self.cache_dir = cache_dir
        os.makedirs(self.cache_dir, exist_ok=True)
        self.lock = threading.Lock()

        self.jd_cache_file = os.path.join(self.cache_dir, "jd_cache.json")
        self.resume_cache_file = os.path.join(self.cache_dir, "resume_cache.json")
        self.eval_cache_file = os.path.join(self.cache_dir, "eval_cache.json")

        self.jd_cache: Dict[str, dict] = self._load_file(self.jd_cache_file)
        self.resume_cache: Dict[str, dict] = self._load_file(self.resume_cache_file)
        self.eval_cache: Dict[str, dict] = self._load_file(self.eval_cache_file)

        self.hits = 0
        self.misses = 0

    def _load_file(self, filepath: str) -> Dict[str, dict]:
        if os.path.exists(filepath):
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                print(f"Cache load notice for {filepath}: {e}")
        return {}

    def _save_file(self, filepath: str, data: Dict[str, dict]):
        try:
            temp_file = filepath + ".tmp"
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            os.replace(temp_file, filepath)
        except Exception as e:
            print(f"Cache save error for {filepath}: {e}")

    @staticmethod
    def hash_text(text: str) -> str:
        """Compute SHA-256 hash of normalized text for instant cache key lookup."""
        normalized = text.strip().lower()
        return hashlib.sha256(normalized.encode("utf-8")).hexdigest()

    # --- Job Description Cache ---
    def get_cached_jd(self, raw_text: str) -> Optional[JobDescription]:
        key = self.hash_text(raw_text)
        with self.lock:
            if key in self.jd_cache:
                self.hits += 1
                try:
                    return JobDescription(**self.jd_cache[key])
                except Exception as e:
                    print(f"Cached JD deserialization error: {e}")
            self.misses += 1
        return None

    def set_cached_jd(self, raw_text: str, jd: JobDescription):
        key = self.hash_text(raw_text)
        with self.lock:
            self.jd_cache[key] = jd.model_dump()
            self._save_file(self.jd_cache_file, self.jd_cache)

    # --- Resume Profile Cache ---
    def get_cached_resume(self, raw_text: str) -> Optional[CandidateProfile]:
        key = self.hash_text(raw_text)
        with self.lock:
            if key in self.resume_cache:
                self.hits += 1
                try:
                    return CandidateProfile(**self.resume_cache[key])
                except Exception as e:
                    print(f"Cached resume deserialization error: {e}")
            self.misses += 1
        return None

    def set_cached_resume(self, raw_text: str, profile: CandidateProfile):
        key = self.hash_text(raw_text)
        with self.lock:
            self.resume_cache[key] = profile.model_dump()
            self._save_file(self.resume_cache_file, self.resume_cache)

    # --- Candidate + Job HR Evaluation Cache ---
    def get_cached_eval(self, cand_raw_text: str, jd_raw_text: str) -> Optional[Dict[str, Any]]:
        combo = f"{cand_raw_text.strip().lower()}||{jd_raw_text.strip().lower()}"
        key = self.hash_text(combo)
        with self.lock:
            if key in self.eval_cache:
                self.hits += 1
                return self.eval_cache[key]
            self.misses += 1
        return None

    def set_cached_eval(self, cand_raw_text: str, jd_raw_text: str, eval_data: Dict[str, Any]):
        combo = f"{cand_raw_text.strip().lower()}||{jd_raw_text.strip().lower()}"
        key = self.hash_text(combo)
        with self.lock:
            self.eval_cache[key] = eval_data
            self._save_file(self.eval_cache_file, self.eval_cache)

    # --- Cache Stats & Clear ---
    def get_stats(self) -> Dict[str, Any]:
        with self.lock:
            return {
                "cached_job_descriptions": len(self.jd_cache),
                "cached_resumes": len(self.resume_cache),
                "cached_hr_evaluations": len(self.eval_cache),
                "cache_hits": self.hits,
                "cache_misses": self.misses,
                "cache_directory": self.cache_dir
            }

    def clear_all(self):
        with self.lock:
            self.jd_cache.clear()
            self.resume_cache.clear()
            self.eval_cache.clear()
            self.hits = 0
            self.misses = 0
            self._save_file(self.jd_cache_file, self.jd_cache)
            self._save_file(self.resume_cache_file, self.resume_cache)
            self._save_file(self.eval_cache_file, self.eval_cache)

# Global singleton instance
cache_manager = CacheManager()
