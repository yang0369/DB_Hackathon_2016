import os
import math
import re
from typing import List, Dict, Any, Optional
from backend.models import CandidateRecord, JobDescription

# Try importing chromadb
try:
    import chromadb
    from chromadb.config import Settings
    CHROMADB_AVAILABLE = True
except ImportError:
    CHROMADB_AVAILABLE = False

# Try importing google.genai SDK
try:
    from google import genai
    GENAI_AVAILABLE = True
except ImportError:
    GENAI_AVAILABLE = False


class VectorStore:
    def __init__(self, persist_directory: str = "./chroma_db"):
        self.persist_directory = persist_directory
        self.client = None
        self.collection = None
        self._init_db()

    def _init_db(self):
        if CHROMADB_AVAILABLE:
            try:
                os.makedirs(self.persist_directory, exist_ok=True)
                self.client = chromadb.PersistentClient(path=self.persist_directory)
                self.collection = self.client.get_or_create_collection(
                    name="resumes",
                    metadata={"hnsw:space": "cosine"}
                )
                print("ChromaDB vector collection initialized.")
            except Exception as e:
                print(f"ChromaDB initialization failed: {e}")
                self.client = None
                self.collection = None
        
        # In-memory storage fallback
        self.candidates_db: Dict[str, CandidateRecord] = {}

    def _get_embedding(self, text: str) -> List[float]:
        """Generate text embedding using Gemini API or fallback TF-IDF vectorizer."""
        api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        
        if api_key and GENAI_AVAILABLE:
            embedding_models = ["gemini-embedding-001", "models/gemini-embedding-001", "gemini-embedding-2"]
            client = genai.Client(api_key=api_key)
            for emb_model in embedding_models:
                try:
                    response = client.models.embed_content(
                        model=emb_model,
                        contents=text[:4000]
                    )
                    if response.embedding and response.embedding.values:
                        return response.embedding.values
                except Exception as e:
                    pass


        # Fallback pseudo-embedding (384-dimensional hashed term frequency vector)
        return self._fallback_embedding(text)

    def _fallback_embedding(self, text: str, dim: int = 384) -> List[float]:
        """Compute a deterministic normalized hashed term frequency vector."""
        vec = [0.0] * dim
        words = re.findall(r'\w+', text.lower())
        if not words:
            return vec
        
        for w in words:
            # Simple hash function mapping word to dimension index
            idx = abs(hash(w)) % dim
            vec[idx] += 1.0
            
        # L2 normalize
        magnitude = math.sqrt(sum(v * v for v in vec))
        if magnitude > 0:
            vec = [v / magnitude for v in vec]
        return vec

    def add_candidate(self, candidate_record: CandidateRecord):
        """Save candidate record to in-memory store and ChromaDB."""
        self.candidates_db[candidate_record.id] = candidate_record
        
        # Prepare text for embedding
        profile = candidate_record.profile
        embed_text = f"""
Name: {profile.full_name}
Summary: {profile.summary}
Skills: {', '.join(profile.skills)}
Experience Years: {profile.years_of_experience}
Raw Resume: {candidate_record.raw_text[:2000]}
"""
        embedding = self._get_embedding(embed_text)

        if self.collection:
            try:
                self.collection.upsert(
                    ids=[candidate_record.id],
                    embeddings=[embedding],
                    documents=[embed_text],
                    metadatas=[{
                        "candidate_name": profile.full_name,
                        "file_name": candidate_record.file_name,
                        "skills": ", ".join(profile.skills[:10]),
                        "years_exp": str(profile.years_of_experience)
                    }]
                )
            except Exception as e:
                print(f"Failed to save candidate to ChromaDB: {e}")

    def search_candidates(self, query_text: str, top_k: int = 10) -> List[Dict[str, Any]]:
        """Search top-k matching candidates for a job description or query."""
        query_embedding = self._get_embedding(query_text)
        results = []

        if self.collection and self.collection.count() > 0:
            try:
                query_res = self.collection.query(
                    query_embeddings=[query_embedding],
                    n_results=min(top_k, self.collection.count())
                )
                
                ids = query_res['ids'][0]
                distances = query_res['distances'][0] if 'distances' in query_res and query_res['distances'] else [0.5]*len(ids)
                
                for cid, dist in zip(ids, distances):
                    if cid in self.candidates_db:
                        # Cosine distance to similarity (0 to 100%)
                        similarity = max(0.0, min(100.0, (1.0 - dist) * 100.0))
                        results.append({
                            "candidate_id": cid,
                            "candidate_record": self.candidates_db[cid],
                            "similarity": round(similarity, 1)
                        })
                return results
            except Exception as e:
                print(f"ChromaDB search query failed: {e}")

        # In-memory cosine similarity fallback search
        for cid, record in self.candidates_db.items():
            doc_text = f"{record.profile.summary} {' '.join(record.profile.skills)} {record.raw_text[:2000]}"
            doc_embedding = self._get_embedding(doc_text)
            
            # Cosine similarity
            dot_product = sum(a * b for a, b in zip(query_embedding, doc_embedding))
            sim_score = max(0.0, min(100.0, dot_product * 100.0))
            
            results.append({
                "candidate_id": cid,
                "candidate_record": record,
                "similarity": round(sim_score, 1)
            })

        results.sort(key=lambda x: x["similarity"], reverse=True)
        return results[:top_k]

    def get_candidate(self, candidate_id: str) -> Optional[CandidateRecord]:
        return self.candidates_db.get(candidate_id)

    def list_all_candidates(self) -> List[CandidateRecord]:
        return list(self.candidates_db.values())
