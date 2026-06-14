import pptxgen from "pptxgenjs";

const pptx = new pptxgen();
const slide = pptx.addSlide();
console.log("slide keys:", Object.keys(slide));
console.log("slide methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(slide)));
