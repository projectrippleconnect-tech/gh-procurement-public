// Bound document processing before allocating large mobile canvases.
export const MAX_EXTRACTION_BYTES=25*1024*1024
export const MAX_EXTRACTION_PAGES=40
export const MAX_OCR_DIMENSION=2800

export function validateExtractionFile(file){
 if(!file)throw new Error('Choose a PDF or image first.')
 if(!Number.isFinite(file.size)||file.size<=0)throw new Error('The document is empty or its size is invalid.')
 if(file.size>MAX_EXTRACTION_BYTES)throw new Error('This document is larger than 25 MB. Split or compress it before reading prices.')
}

export function validateExtractionPages(pages){
 if(!Number.isInteger(pages)||pages<1)throw new Error('The PDF has no readable pages.')
 if(pages>MAX_EXTRACTION_PAGES)throw new Error('This PDF has '+pages+' pages. Split it into documents of 40 pages or fewer; no prices have been imported.')
 return pages
}

export function boundedCanvasSize(width,height,{upscale=false}={}){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('The document image dimensions are invalid.')
 const desired=upscale?Math.min(3,Math.max(1,1800/width)):1
 const scale=Math.min(desired,MAX_OCR_DIMENSION/width,MAX_OCR_DIMENSION/height)
 return {width:Math.max(1,Math.floor(width*scale)),height:Math.max(1,Math.floor(height*scale)),scale}
}
