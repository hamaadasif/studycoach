import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from "firebase/storage";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { storage, db } from "./firebase";

export type UploadRecord = {
  id: string;
  name: string;
  storagePath: string;
  url: string;
  contentType: string;
  size: number;
  createdAt?: any;
};

export type UploadProgress = {
  state: "idle" | "uploading" | "done" | "error";
  pct: number;
  error?: string;
};

const MAX_MB = 10;
const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

function safeFileName(name: string) {
  return name.replace(/[^\w.\-() ]+/g, "_").trim();
}

export function validateSyllabusFile(file: File) {
  if (!ALLOWED_MIME.has(file.type)) {
    return `Unsupported file type (${file.type || "unknown"}). Use PDF, DOC, DOCX, or TXT.`;
  }
  const maxBytes = MAX_MB * 1024 * 1024;
  if (file.size > maxBytes) {
    return `File too large. Max is ${MAX_MB}MB.`;
  }
  return null;
}

export async function uploadSyllabusForCourse(args: {
  uid: string;
  courseId: string;
  file: File;
  onProgress?: (pct: number) => void;
}) {
  const { uid, courseId, file, onProgress } = args;

  const cleanName = safeFileName(file.name);
  const ext = cleanName.split(".").pop() || "file";
  const stamp = Date.now();

  const storagePath = `users/${uid}/courses/${courseId}/syllabus/${stamp}-${cleanName}`;
  const storageRef = ref(storage, storagePath);

  const uploadTask = uploadBytesResumable(storageRef, file, {
    contentType: file.type,
  });

  const url: string = await new Promise((resolve, reject) => {
    uploadTask.on(
      "state_changed",
      (snap) => {
        const pct = snap.totalBytes ? (snap.bytesTransferred / snap.totalBytes) * 100 : 0;
        onProgress?.(Math.round(pct));
      },
      (err) => reject(err),
      async () => {
        const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
        resolve(downloadURL);
      }
    );
  });

  const uploadsCol = collection(db, "users", uid, "courses", courseId, "uploads");
  const docRef = await addDoc(uploadsCol, {
    name: cleanName,
    storagePath,
    url,
    contentType: file.type || "",
    size: file.size,
    createdAt: serverTimestamp(),
  });

  return { uploadId: docRef.id, url, storagePath, name: cleanName };
}

export async function deleteUpload(args: { uid: string; courseId: string; uploadId: string; storagePath: string }) {
  const { uid, courseId, uploadId, storagePath } = args;

  await deleteObject(ref(storage, storagePath));

  await deleteDoc(doc(db, "users", uid, "courses", courseId, "uploads", uploadId));
}
