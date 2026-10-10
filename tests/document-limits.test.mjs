import test from 'node:test'
import assert from 'node:assert/strict'
import {boundedCanvasSize,validateExtractionFile,validateExtractionPages,MAX_EXTRACTION_BYTES} from '../lib/document-limits.js'

test('large image and PDF canvases downscale before OCR without stretching',()=>{
 assert.deepEqual(boundedCanvasSize(12000,8000,{upscale:true}),{width:2800,height:1866,scale:2800/12000})
 assert.deepEqual(boundedCanvasSize(1000,20000),{width:140,height:2800,scale:0.14})
 assert.deepEqual(boundedCanvasSize(600,400,{upscale:true}),{width:1800,height:1200,scale:3})
 for(const [width,height] of [[Infinity,200],[0,100],[100,NaN],[-1,100]])assert.throws(()=>boundedCanvasSize(width,height),/dimensions are invalid/)
})

test('PDF extraction refuses truncation and rejects empty or oversized files',()=>{
 assert.equal(validateExtractionPages(40),40)
 assert.throws(()=>validateExtractionPages(41),/no prices have been imported/)
 assert.throws(()=>validateExtractionPages(0),/no readable pages/)
 assert.doesNotThrow(()=>validateExtractionFile({size:MAX_EXTRACTION_BYTES}))
 for(const size of [0,-1,NaN,Infinity])assert.throws(()=>validateExtractionFile({size}),/empty or its size is invalid/)
 assert.throws(()=>validateExtractionFile({size:MAX_EXTRACTION_BYTES+1}),/larger than 25 MB/)
})
