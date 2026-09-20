const visualLabels = {
  not_reviewed: "chưa xem hình",
  sampled_frames: "ảnh mẫu",
  motion_samples: "đoạn chuyển động mẫu",
  continuous_playback: "Agent khai đã xem hình liên tục"
};

const audioLabels = {
  not_reviewed: "chưa đánh giá tiếng",
  analysis_only: "chỉ phân tích tiếng/ASR",
  sampled_listening: "nghe đoạn mẫu",
  continuous_listening: "Agent khai đã nghe liên tục",
  not_applicable: "không có tiếng"
};

export function reviewInspectionLabel(review) {
  if (review.attestation) return review.attestation.listenedFull === true
    ? " · người dùng xác nhận xem/nghe đầy đủ"
    : " · người dùng xác nhận xem đầy đủ · tiếng không áp dụng";
  if (!review.inspection) return "";
  const visual = visualLabels[review.inspection.visual?.method] ?? "hình chưa rõ phạm vi";
  const audio = audioLabels[review.inspection.audio?.method] ?? "tiếng chưa rõ phạm vi";
  const limits = review.inspection.limitations?.length
    ? ` · giới hạn: ${review.inspection.limitations.join("; ")}`
    : "";
  return ` · ${visual} · ${audio}${limits}`;
}
