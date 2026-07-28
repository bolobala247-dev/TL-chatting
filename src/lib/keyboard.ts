import {
  KeyboardAvoidingView,
  KeyboardAwareScrollView,
} from "react-native-keyboard-controller";
import { cssInterop } from "nativewind";

// react-native-keyboard-controller components are not RN core components,
// so NativeWind needs explicit className → style mappings for them.
cssInterop(KeyboardAvoidingView, { className: "style" });
cssInterop(KeyboardAwareScrollView, {
  className: "style",
  contentContainerClassName: "contentContainerStyle",
});

export { KeyboardAvoidingView, KeyboardAwareScrollView };
