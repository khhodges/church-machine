let activeEditingSlideId: string | null = null;

export function setActiveEditingSlide(slideId: string) {
  activeEditingSlideId = slideId;
}

export function clearActiveEditingSlide(slideId: string) {
  if (activeEditingSlideId === slideId) {
    activeEditingSlideId = null;
  }
}

export function isSdmEditingActive(): boolean {
  return activeEditingSlideId !== null;
}
