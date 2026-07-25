export default {
  container: {
    flex: 1,
    backgroundColor: "#0a0a0a",
  },
  safeArea: {
    flex: 1,
  },
  gradient: {
    flex: 1,
  },

  // Home / Record screen
  homeContainer: {
    flex: 1,
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 40,
  },
  logoContainer: {
    alignItems: "center",
    marginTop: 20,
  },
  logo: {
    fontSize: 42,
    fontWeight: "900",
    color: "#00FF88",
    letterSpacing: 2,
  },
  tagline: {
    fontSize: 14,
    color: "#666",
    marginTop: 8,
    letterSpacing: 1,
  },
  recordSection: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  recordButton: {
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 4,
    borderColor: "#00FF88",
    justifyContent: "center",
    alignItems: "center",
  },
  recordButtonInner: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "#00FF88",
    justifyContent: "center",
    alignItems: "center",
  },
  recordButtonRecording: {
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 4,
    borderColor: "#FF4444",
    justifyContent: "center",
    alignItems: "center",
  },
  recordButtonInnerRecording: {
    width: 80,
    height: 80,
    borderRadius: 12,
    backgroundColor: "#FF4444",
  },
  recordLabel: {
    color: "#0a0a0a",
    fontSize: 16,
    fontWeight: "800",
  },
  recordLabelRecording: {
    color: "#FF4444",
    fontSize: 14,
    fontWeight: "700",
    marginTop: 16,
  },
  timerText: {
    color: "#00FF88",
    fontSize: 32,
    fontWeight: "300",
    fontFamily: "monospace",
    marginTop: 20,
    textAlign: "center",
  },
  optionsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginBottom: 20,
  },
  optionButton: {
    alignItems: "center",
    padding: 12,
  },
  optionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#1a1a2e",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 6,
  },
  optionLabel: {
    color: "#888",
    fontSize: 11,
    fontWeight: "600",
  },

  // Processing screen
  processingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  processingTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "800",
    marginTop: 30,
  },
  processingSubtitle: {
    color: "#888",
    fontSize: 14,
    marginTop: 10,
    textAlign: "center",
  },
  processingSteps: {
    marginTop: 40,
    width: "100%",
    gap: 16,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#111",
    borderRadius: 12,
  },
  stepRowActive: {
    backgroundColor: "#0a1a10",
    borderWidth: 1,
    borderColor: "#00FF88",
  },
  stepRowDone: {
    backgroundColor: "#0a1a10",
  },
  stepIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#222",
    justifyContent: "center",
    alignItems: "center",
  },
  stepText: {
    color: "#888",
    fontSize: 14,
    fontWeight: "600",
    flex: 1,
  },
  stepTextActive: {
    color: "#00FF88",
  },
  stepTextDone: {
    color: "#00FF88",
  },

  // Results screen
  resultsContainer: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 60,
  },
  resultsTitle: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "800",
    textAlign: "center",
  },
  resultsSubtitle: {
    color: "#666",
    fontSize: 13,
    textAlign: "center",
    marginTop: 6,
  },
  keyBadge: {
    alignSelf: "center",
    backgroundColor: "#00FF88",
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: 16,
  },
  keyBadgeText: {
    color: "#0a0a0a",
    fontSize: 13,
    fontWeight: "800",
  },
  playerCard: {
    backgroundColor: "#111",
    borderRadius: 20,
    padding: 20,
    marginTop: 30,
  },
  playerTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  playerSubtitle: {
    color: "#666",
    fontSize: 12,
    marginTop: 2,
  },
  playButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#00FF88",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 16,
    alignSelf: "center",
  },
  progressBar: {
    height: 4,
    backgroundColor: "#222",
    borderRadius: 2,
    marginTop: 16,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#00FF88",
    borderRadius: 2,
  },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  timeText: {
    color: "#666",
    fontSize: 11,
    fontFamily: "monospace",
  },
  downloadButton: {
    backgroundColor: "#1a1a2e",
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 20,
  },
  downloadButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  retakeButton: {
    alignItems: "center",
    marginTop: 16,
    paddingVertical: 12,
  },
  retakeText: {
    color: "#666",
    fontSize: 14,
    fontWeight: "600",
  },

  // Settings / Options
  settingsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
  },
  settingsLabel: {
    color: "#aaa",
    fontSize: 14,
    fontWeight: "600",
  },
  settingsValue: {
    color: "#00FF88",
    fontSize: 14,
    fontWeight: "700",
  },
  slider: {
    width: "100%",
    height: 4,
    marginTop: 8,
  },

  // Waveform
  waveformContainer: {
    height: 80,
    backgroundColor: "#111",
    borderRadius: 12,
    overflow: "hidden",
    marginVertical: 16,
  },
  waveform: {
    flex: 1,
  },

  // Bottom tab
  tabBar: {
    backgroundColor: "#0a0a0a",
    borderTopWidth: 0,
    height: 70,
    paddingBottom: 10,
    paddingTop: 6,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: "600",
  },
};
