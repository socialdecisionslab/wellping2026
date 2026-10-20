import Foundation
import Vision
import AppKit

// OCR checks the actual simulator image rather than just process survival.
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let image = NSImage(contentsOf: url)!
var rect = CGRect(origin: .zero, size: image.size)
let cg = image.cgImage(forProposedRect: &rect, context: nil, hints: nil)!
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
try VNImageRequestHandler(cgImage: cg).perform([request])
let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
print(text)
guard text.contains("Who were you talking to?"), !text.contains("FunctionCallException"), !text.contains("keyChainException") else {
  fputs("Questionnaire failed to render on simulator\n", stderr)
  exit(1)
}
